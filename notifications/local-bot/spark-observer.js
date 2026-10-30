'use strict';
// Roommates Expenses: Spark-friendly local event monitor, READ ONLY / NO SEND.
// Requires Firebase Admin ADC credentials. Polls Firestore and prints previews.
const admin=require('firebase-admin');
const fs=require('node:fs');
const path=require('node:path');
const statePath=path.join(__dirname,'.observer-state.json');
const tz='Asia/Jerusalem';
const sources=[
  {collection:'tasks_bar_ilan',label:'task',kind:'tasks'},
  {collection:'expenses',label:'expense',kind:'expenses'},
  {collection:'shoppingList_bar_ilan',label:'shopping',kind:'shopping'}
];
function ilDay(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t).value;
  return get('year')+'-'+get('month')+'-'+get('day');
}
function ilHour(now=new Date()){return +new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',hourCycle:'h23'}).format(now)}
function safe(x){return String(x??'').slice(0,140).replace(/[\r\n]+/g,' ')}
function stamp(x){if(x?.toMillis)return x.toMillis();if(typeof x==='string')return Date.parse(x)||0;return 0}
if(!process.env.GOOGLE_APPLICATION_CREDENTIALS){
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS. Do not put credentials inside this repository.');
  process.exit(1);
}
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'roommates-expenses-bar-ilan'});
const db=admin.firestore();
let state;
try{state=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{state={initialized:false,docs:{},reminded:{}}}
function save(){const temp=statePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.renameSync(temp,statePath)}
let busy=false;
async function poll(){
 if(busy)return;busy=true;
 try{
  const snapshots=await Promise.all(sources.map(s=>db.collection(s.collection).get()));
  const seen={};
  for(let i=0;i<sources.length;i++){
   const src=sources[i];
   for(const doc of snapshots[i].docs){
    const d=doc.data(), key=src.collection+'/'+doc.id;
    const old=state.docs[key];
    const status=d.status||'open';
    const version=stamp(d.updatedAt)||stamp(d.createdAt);
    seen[key]={status,version};
    if(!state.initialized||!old)continue; // No historical messages or new docs until after baseline.
    if(src.kind==='tasks'&&old.status!=='done'&&status==='done'){
      console.log('[PREVIEW task_completed]',safe(d.title),'|',safe(d.assignee));
    }
   }
  }
  if(state.initialized){
   // Fresh documents (not part of initial baseline).
   for(let i=0;i<sources.length;i++){
    const src=sources[i];
    for(const doc of snapshots[i].docs){
     const key=src.collection+'/'+doc.id;
     if(state.docs[key])continue;
     const d=doc.data();
     if(src.kind==='tasks')console.log('[PREVIEW task_created]',safe(d.title),'|',safe(d.assignee));
     if(src.kind==='expenses')console.log('[PREVIEW expense_created]',safe(d.description),'| ₪'+safe(d.amount),'|',safe(d.roommate));
     if(src.kind==='shopping'&&d.name)console.log('[PREVIEW shopping_added]',safe(d.name),'| qty:',safe(d.qty||1));
    }
   }
  }
  const now=new Date(),day=ilDay(now);
  if(ilHour(now)>=9){
   const snap=snapshots[0];
   for(const doc of snap.docs){
    const d=doc.data(),key=day+'/'+doc.id;
    if(d.due===day&&d.status!=='done'&&!state.reminded[key]&&state.initialized){
      console.log('[PREVIEW 09:00 reminder]',safe(d.title),'|',safe(d.assignee));
      state.reminded[key]=true;
    }
   }
  }
  state.docs=seen;state.initialized=true;
  state.reminded=Object.fromEntries(Object.entries(state.reminded).filter(([k])=>k>=day.slice(0,7)));
  save();
  console.log('[CHECK]',new Date().toLocaleTimeString('he-IL',{timeZone:tz}), 'read-only; no WhatsApp sends');
 }catch(e){console.error('[ERROR]',e.message)}
 finally{busy=false}
}
console.log('DRY RUN monitor; no WhatsApp client and no writes to Firestore. Ctrl+C to stop.');
poll();setInterval(poll,60000);
