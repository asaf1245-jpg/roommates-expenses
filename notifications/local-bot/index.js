'use strict';
// Local-only Firestore outbox worker. Default: dry-run. Do not deploy to GitHub Pages.
// Requires local Firebase Admin service account; never commit credentials.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const admin=require('firebase-admin');
const {Client,LocalAuth}=require('whatsapp-web.js');
const qrcode=require('qrcode-terminal');
const ROOT=__dirname;
const IS_LIVE=process.env.AK_WA_MODE==='live';
const TARGET='בר אילן 19';
const SECRET_PATH=process.env.GOOGLE_APPLICATION_CREDENTIALS;
if(!SECRET_PATH||!fs.existsSync(SECRET_PATH)){
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS pointing to private service account JSON. No messages sent.');process.exit(1);
}
const browserPaths=[
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const browser=browserPaths.find(p=>fs.existsSync(p));
if(!browser){console.error('No Chrome/Edge available');process.exit(1)}
admin.initializeApp({credential:admin.credential.applicationDefault()});
const db=admin.firestore();
const client=new Client({authStrategy:new LocalAuth({clientId:'roommates-bot',dataPath:path.resolve(ROOT,'../../../private-session')}),puppeteer:{executablePath:browser,headless:true}});
let running=false;
let stopping=false;
let group;
let timer;
async function processQueue(){
 if(running||stopping)return;
 running=true;
 try{
  const conf=(await db.doc('notificationSettings/whatsapp').get()).data()||{};
  const snap=await db.collection('whatsappOutbox').where('status','==','pending').limit(10).get();
  if(snap.empty)return;
  console.log('Pending:',snap.size,'Mode:',IS_LIVE?'live':'dry-run');
  for(const doc of snap.docs){
   const item=doc.data();
   if(typeof item.text!=='string'||item.text.length>1500){console.warn('Skipped invalid item:',doc.id);continue;}
   if(!IS_LIVE||conf.enabled!==true){
    console.log('[PREVIEW]',doc.id,item.type,JSON.stringify(item.text));
    continue;
   }
   if(!group){console.error('No selected group. No send.');return}
   // Transaction lock avoids two workers claiming same event.
   const reserved=await db.runTransaction(async tx=>{
    const fresh=await tx.get(doc.ref);
    if(fresh.data()?.status!=='pending')return false;
    tx.update(doc.ref,{status:'sending',claimedAt:admin.firestore.FieldValue.serverTimestamp()});
    return true;
   });
   if(!reserved)continue;
   try{
    // Mark any uncertain result as needs_review to prevent blind repeat.
    const outcome=await client.sendMessage(group.id._serialized||group.id.$1,item.text);
    await doc.ref.update({status:'needs_review',sendAttemptAt:admin.firestore.FieldValue.serverTimestamp(),note:'Send attempted. Verify in group and mark sent manually. No automatic retry.'});
    console.log('Attempted:',doc.id,Boolean(outcome?.id));
   }catch(e){
    await doc.ref.update({status:'needs_review',lastError:String(e).slice(0,350),sendAttemptAt:admin.firestore.FieldValue.serverTimestamp()});
    console.error('Uncertain attempt, no retry:',doc.id,e.message);
   }
  }
 }catch(e){console.error('Worker error:',e.message)}
 finally{running=false}
}
client.on('qr',qr=>{console.log('Scan QR on your dedicated POCO account');qrcode.generate(qr,{small:true})});
client.on('authenticated',()=>console.log('Authenticated'));
client.on('ready',async()=>{
 console.log('Connected. Checking group...');
 try{
  const chats=await client.getChats();
  const matches=chats.filter(c=>c.isGroup&&c.name===TARGET);
  if(matches.length!==1){console.error('Expected exactly one named group; found',matches.length,'Nothing will be sent.');return;}
  group=matches[0];
  console.log('Group found:',TARGET,'mode:',IS_LIVE?'LIVE (requires Firestore enabled)':'DRY RUN');
  await processQueue();
  timer=setInterval(processQueue,30000);
 }catch(e){console.error('Unable to resolve target group. No messages:',e.message)}
});
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);try{await client.destroy()}catch(e){console.error(e.message)}process.exit(0)}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
client.initialize().catch(e=>{console.error('Start failed:',e.message);process.exitCode=1});
