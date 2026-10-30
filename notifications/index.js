'use strict';
// Firebase Functions v2 - deploy separately from GitHub Pages.
// All delivery is OFF until a trusted WhatsApp group gateway is configured.
const {onDocumentCreated,onDocumentUpdated}=require('firebase-functions/v2/firestore');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {defineSecret}=require('firebase-functions/params');
const admin=require('firebase-admin');
admin.initializeApp();
const db=admin.firestore();
const GATEWAY_URL=defineSecret('AK_WA_GATEWAY_URL');
const GATEWAY_TOKEN=defineSecret('AK_WA_GATEWAY_TOKEN');
const GROUP_ID=defineSecret('AK_WA_GROUP_ID');
const REGION='europe-west1';
const ZONE='Asia/Jerusalem';
const defaults={task_created:true,task_completed:true,expense_created:true,shopping_added:true,task_reminder:true,enabled:false};
function dateIL(date){return new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
function pretty(v){return String(v??'').slice(0,250).replace(/[<>]/g,'')}
async function config(){const doc=await db.doc('notificationSettings/whatsapp').get();return {...defaults,...(doc.data()||{})}}
async function queue(id,type,text,enabled){if(!enabled)return;await db.collection('whatsappOutbox').doc(id).create({type,text,createdAt:admin.firestore.FieldValue.serverTimestamp(),status:'pending',attempts:0}).catch(e=>{if(e.code!==6&&e.code!=='already-exists')throw e})}
exports.taskCreated=onDocumentCreated({document:'tasks_bar_ilan/{id}',region:REGION},async event=>{const c=await config(),t=event.data?.data();if(t)await queue('task-new-'+event.params.id,'task_created',`🏠 משימה חדשה\n${pretty(t.title)}\nאחראי: ${pretty(t.assignee)}\nיעד: ${pretty(t.due||'ללא יעד')}`,c.enabled&&c.task_created)});
exports.taskCompleted=onDocumentUpdated({document:'tasks_bar_ilan/{id}',region:REGION},async event=>{const before=event.data.before.data(),t=event.data.after.data(),c=await config();if(before.status!=='done'&&t.status==='done')await queue('task-done-'+event.params.id+'-'+event.data.after.updateTime.toMillis(),'task_completed',`✅ משימה הושלמה\n${pretty(t.title)}\nאחראי: ${pretty(t.assignee)}`,c.enabled&&c.task_completed)});
exports.expenseCreated=onDocumentCreated({document:'expenses/{id}',region:REGION},async event=>{const t=event.data?.data(),c=await config();if(t)await queue('expense-'+event.params.id,'expense_created',`💳 הוצאה חדשה\n${pretty(t.description)}\n₪${pretty(t.amount)}\nשותף: ${pretty(t.roommate)}`,c.enabled&&c.expense_created)});
exports.shoppingCreated=onDocumentCreated({document:'shoppingList_bar_ilan/{id}',region:REGION},async event=>{const t=event.data?.data(),c=await config();if(t&&t.name)await queue('shopping-'+event.params.id,'shopping_added',`🛒 נוסף לרשימת הקניות: ${pretty(t.name)}\nכמות: ${pretty(t.qty||1)}`,c.enabled&&c.shopping_added)});
exports.morningReminders=onSchedule({schedule:'0 9 * * *',timeZone:ZONE,region:REGION},async()=>{const c=await config();if(!c.enabled||!c.task_reminder)return;const today=dateIL(new Date()),snap=await db.collection('tasks_bar_ilan').where('due','==',today).get();for(const d of snap.docs){const t=d.data();if(t.status==='done')continue;await queue('reminder-'+today+'-'+d.id,'task_reminder',`⏰ תזכורת להיום\n${pretty(t.title)}\nאחראי: ${pretty(t.assignee)}`,true)}});
// Scheduled dispatcher. Uses a private group gateway, never a browser-exposed key.
// One in-flight lease per message prevents concurrent dispatch. Transport has unavoidable
// ambiguous-response duplicates; gateway SHOULD support Idempotency-Key.
exports.deliver=onSchedule({schedule:'every 1 minutes',region:REGION,secrets:[GATEWAY_URL,GATEWAY_TOKEN,GROUP_ID]},async()=>{const c=await config();if(!c.enabled)return;const snap=await db.collection('whatsappOutbox').where('status','==','pending').limit(20).get();for(const d of snap.docs){const leased=await db.runTransaction(async tx=>{const cur=await tx.get(d.ref);if(cur.data()?.status!=='pending')return false;tx.update(d.ref,{status:'sending',attempts:admin.firestore.FieldValue.increment(1),lockedAt:admin.firestore.FieldValue.serverTimestamp()});return true});if(!leased)continue;try{const resp=await fetch(GATEWAY_URL.value(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+GATEWAY_TOKEN.value(),'Idempotency-Key':d.id},body:JSON.stringify({groupId:GROUP_ID.value(),text:d.data().text,eventId:d.id}),signal:AbortSignal.timeout(15000)});if(!resp.ok)throw Error('Gateway HTTP '+resp.status);await d.ref.update({status:'sent',sentAt:admin.firestore.FieldValue.serverTimestamp()})}catch(e){await d.ref.update({status:'failed',lastError:String(e).slice(0,200)})}}});
