const talkBtn=document.querySelector('#talkBtn');
const muteBtn=document.querySelector('#muteBtn');
const endBtn=document.querySelector('#endBtn');
const captionSpeaker=document.querySelector('#captionSpeaker');
const captionText=document.querySelector('#captionText');
const stateBadge=document.querySelector('#stateBadge');
const errorBox=document.querySelector('#errorBox');
const settingsBtn=document.querySelector('#settingsBtn');
const settingsDialog=document.querySelector('#settingsDialog');
const apiKeyInput=document.querySelector('#apiKeyInput');
const rememberKey=document.querySelector('#rememberKey');
const saveKeyBtn=document.querySelector('#saveKeyBtn');
const deleteKeyBtn=document.querySelector('#deleteKeyBtn');
const speechRateInput=document.querySelector('#speechRate');
const speechRateValue=document.querySelector('#speechRateValue');

let ws=null,stream=null,audioCtx=null,source=null,processor=null;
let muted=false,setupDone=false,toolBusy=false,playTime=0;
let userCaption='',miniCaption='',lastSpeaker='';
let currentToken='',resumeHandle='',reconnectTimer=null;
let reconnecting=false,shouldStayConnected=false,startedOnce=false;
const scheduledNodes=new Set();

const MODEL='gemini-3.1-flash-live-preview';
const VOICE='Kore';
const memoryKey='co_giao_mini_memory_v1';
const apiStorageKey='co_giao_mini_gemini_key';
const rateStorageKey='co_giao_mini_speech_rate_v5';
let memory=loadMemory();
let speechRate=loadSpeechRate();

function loadMemory(){
  try{return JSON.parse(localStorage.getItem(memoryKey)||'null')||{nickname:'Hà Anh',interests:[],words:{},errors:[]}}
  catch{return {nickname:'Hà Anh',interests:[],words:{},errors:[]}}
}
function saveMemory(){localStorage.setItem(memoryKey,JSON.stringify(memory))}
function compactMemory(){
  const words=Object.fromEntries(Object.entries(memory.words||{}).slice(-24));
  return {
    nickname:memory.nickname||'Hà Anh',
    interests:(memory.interests||[]).slice(-8),
    words,
    errors:(memory.errors||[]).slice(-8)
  };
}
function getApiKey(){return sessionStorage.getItem(apiStorageKey)||localStorage.getItem(apiStorageKey)||''}
function setApiKey(v,remember){
  sessionStorage.setItem(apiStorageKey,v);
  if(remember)localStorage.setItem(apiStorageKey,v);else localStorage.removeItem(apiStorageKey);
}
function loadSpeechRate(){
  const n=Number(localStorage.getItem(rateStorageKey)||80);
  return Math.min(1,Math.max(.5,(Number.isFinite(n)?n:80)/100));
}
function setSpeechRatePercent(v){
  const p=Math.min(100,Math.max(50,Math.round(Number(v)/5)*5));
  speechRate=p/100;
  localStorage.setItem(rateStorageKey,String(p));
  speechRateInput.value=String(p);
  speechRateValue.textContent=`${p}%`;
}
function showError(e){errorBox.textContent=String(e?.message||e);errorBox.classList.remove('hidden')}
function clearError(){errorBox.classList.add('hidden');errorBox.textContent=''}
function childName(){return memory.nickname||'Hà Anh'}
function setState(s){
  const x={idle:'Sẵn sàng',connecting:'Đang kết nối…',reconnecting:'Đang nối lại…',listening:`Đang nghe ${childName()}…`,speaking:'Cô Giáo Mini đang nói…',thinking:'Đang suy nghĩ…'};
  stateBadge.textContent=x[s]||s;
}
function showCaption(speaker,text){
  if(!text||!String(text).trim())return;
  lastSpeaker=speaker;captionSpeaker.textContent=speaker;captionText.textContent=String(text).trim();
}
function b64(bytes){let s='',step=0x8000;for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(s)}
function fromB64(s){const bin=atob(s),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function floatToPCM16(input){const out=new Int16Array(input.length);for(let i=0;i<input.length;i++){const v=Math.max(-1,Math.min(1,input[i]));out[i]=v<0?v*0x8000:v*0x7fff}return new Uint8Array(out.buffer)}
function resample(input,inRate,outRate){
  if(inRate===outRate)return input;
  const ratio=inRate/outRate,n=Math.round(input.length/ratio),out=new Float32Array(n);
  for(let i=0;i<n;i++){const p=i*ratio,a=Math.floor(p),bb=Math.min(a+1,input.length-1),t=p-a;out[i]=input[a]*(1-t)+input[bb]*t}
  return out;
}
function playPCM24(base64){
  if(!audioCtx)return;
  const bytes=fromB64(base64),pcm=new Int16Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/2));
  const floats=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)floats[i]=pcm[i]/32768;
  const buf=audioCtx.createBuffer(1,floats.length,24000);buf.copyToChannel(floats,0);
  const node=audioCtx.createBufferSource();node.buffer=buf;node.playbackRate.value=speechRate;node.connect(audioCtx.destination);
  node.onended=()=>scheduledNodes.delete(node);scheduledNodes.add(node);
  const now=audioCtx.currentTime;if(playTime<now)playTime=now;
  node.start(playTime);playTime+=buf.duration/speechRate;setState('speaking');
}
function stopPlayback(){
  for(const n of scheduledNodes){try{n.stop()}catch{}}
  scheduledNodes.clear();playTime=audioCtx?.currentTime||0;
}
function teacherPrompt(){
return `You are Mini, the AI speaking partner and English teacher in "Cô Giáo Mini", for a Vietnamese child age 6 named ${childName()}.

CORE MINDSET — MINIMUM HELPFUL TURN:
Before every reply, silently ask: "What is the smallest helpful thing the child needs right now?"
Answer that, then stop.
Do not show off knowledge. Do not over-explain.
Default to ONE short sentence. Use TWO only when needed.
Usually 5–20 spoken words total.
Ask at most ONE easy question, and only when a question naturally helps the conversation.
Silence is allowed. Do not fill every pause.

SPEAKING STYLE:
- Speak slowly, clearly, warmly, and with short chunks suitable for a six-year-old.
- The app may also slow playback, so keep pronunciation natural and do not drag individual sounds unnaturally.
- Use simple vocabulary and concrete examples.
- Never give long lists unless the child explicitly asks.

BILINGUAL:
- Understand Vietnamese, English, and mixed Vietnamese-English.
- Prefer simple English, but Vietnamese is a bridge when it helps understanding.
- If the child asks a real question in Vietnamese, answer the question first. Then add only the most useful English word or tiny sentence.
- If confused, explain ONE layer in simple Vietnamese, then stop. Only explain deeper if the child asks again.
- Do not translate everything.

SHORT REPAIR LOOP — imitate a good speaking partner, not a grammar lecture:
1. Understand the child's intended meaning first.
2. Do NOT correct every mistake. If communication is working and the mistake is not useful to fix now, keep the conversation moving.
3. If one correction matters, correct ONE thing only.
4. Prefer a model phrase instead of a grammar rule.
5. If useful, invite ONE repeat.
6. After the child says it correctly once, acknowledge briefly and immediately continue the conversation.
7. Never force 3–5 repetitions.
8. Never say "Wrong" or shame the child.

Examples:
Child: "I have six."
Mini: "Con muốn nói: 'I'm six.' Say: 'I'm six.'"
Child: "I'm six."
Mini: "Yes. What do you like to play?"

Child: "I am Vietnam."
Mini: "Gần đúng rồi. Say: 'I'm from Vietnam.'"
Child: "I'm from Vietnam."
Mini: "Yes. What food do you like?"

Child: "Yesterday I go zoo and see elephant!"
If the child is excited, do NOT interrupt with a grammar lecture.
Mini: "Wow, an elephant! Was it big?"

PRAISE:
- Praise selectively, not after every turn.
- Prefer natural acknowledgements: "Yes.", "Đúng rồi.", "I see.", "Ồ!"
- Avoid repetitive "Amazing!", "Great job!", "Excellent!"

CONVERSATION:
- Do not turn normal conversation into a quiz.
- Follow the child's topic and curiosity.
- Do not automatically ask a question after every answer.
- If the child tells a story, react like a real listener first.
- One learning target at a time.

OPENING:
Vary openings. Keep it brief. Invite the child to talk, ask, play a tiny game, or hear a short story.
Never repeatedly default to color questions.

MEMORY:
Current learning memory: ${JSON.stringify(compactMemory())}
Use it naturally; never reveal raw memory.
Use memory tools only for durable learning-relevant information.
Never store address, school name, phone, exact location, full legal name, passwords, email, or unnecessary private information.

SAFETY:
Everything must be age-appropriate for a six-year-old.
Never encourage secrecy from parents or caregivers.
For danger, injury, or emergencies, tell the child to get a trusted adult immediately.`;
}

async function mintToken(apiKey){
  const expire=new Date(Date.now()+30*60*1000).toISOString();
  const newSessionExpire=new Date(Date.now()+60*1000).toISOString();
  const body={
    uses:1,
    expireTime:expire,
    newSessionExpireTime:newSessionExpire,
    liveConnectConstraints:{
      model:`models/${MODEL}`,
      config:{sessionResumption:{},responseModalities:['AUDIO']}
    }
  };
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens',{
    method:'POST',headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const x=await r.json();
  if(!r.ok)throw new Error(`Gemini token HTTP ${r.status}: ${JSON.stringify(x)}`);
  if(!x.name)throw new Error('Gemini không trả ephemeral token.');
  return x.name;
}

function setupPayload(handle=''){
  const sessionResumption=handle?{handle}:{};
  return {setup:{
    model:`models/${MODEL}`,
    generationConfig:{
      responseModalities:['AUDIO'],
      speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:VOICE}}}
    },
    realtimeInputConfig:{
      automaticActivityDetection:{
        startOfSpeechSensitivity:'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity:'END_SENSITIVITY_LOW',
        prefixPaddingMs:40,
        silenceDurationMs:900
      }
    },
    sessionResumption,
    contextWindowCompression:{slidingWindow:{}},
    inputAudioTranscription:{},
    outputAudioTranscription:{},
    systemInstruction:{parts:[{text:teacherPrompt()}]},
    tools:[{functionDeclarations:[
      {name:'remember_child_name',description:'Save the child preferred first name or nickname only after clearly stated.',parameters:{type:'OBJECT',properties:{name:{type:'STRING'}},required:['name']}},
      {name:'remember_interest',description:'Save a stable age-appropriate interest useful for future conversations.',parameters:{type:'OBJECT',properties:{interest:{type:'STRING'}},required:['interest']}},
      {name:'record_word_progress',description:'Record a clear English learning event; do not call for every word.',parameters:{type:'OBJECT',properties:{word:{type:'STRING'},event:{type:'STRING',enum:['recognized','repeated','recalled','used_independently','needs_practice']}},required:['word','event']}},
      {name:'record_learning_error',description:'Save a recurring or educationally useful English mistake, not every slip.',parameters:{type:'OBJECT',properties:{type:{type:'STRING'},original:{type:'STRING'},target:{type:'STRING'}},required:['original','target']}}
    ]}]
  }};
}

async function handleToolCall(toolCall){
  const calls=toolCall?.functionCalls||[];if(!calls.length)return;
  toolBusy=true;const responses=[];
  for(const fc of calls){
    try{
      const a=fc.args||{};
      if(fc.name==='remember_child_name'&&a.name){
        const n=String(a.name).trim();if(n&&n.length<=40&&n.split(/\s+/).length<=3)memory.nickname=n;
      }else if(fc.name==='remember_interest'&&a.interest){
        const v=String(a.interest).trim();
        if(v&&v.length<=80&&!memory.interests.some(x=>x.toLowerCase()===v.toLowerCase()))memory.interests.push(v);
        memory.interests=memory.interests.slice(-20);
      }else if(fc.name==='record_word_progress'&&a.word&&a.event){
        const w=String(a.word).toLowerCase().trim();
        memory.words[w] ||= {recognized:0,repeated:0,recalled:0,used_independently:0,needs_practice:0};
        memory.words[w][a.event]=(memory.words[w][a.event]||0)+1;
        const keys=Object.keys(memory.words);if(keys.length>60)for(const k of keys.slice(0,keys.length-60))delete memory.words[k];
      }else if(fc.name==='record_learning_error'&&a.original&&a.target){
        let e=memory.errors.find(x=>x.original===a.original&&x.target===a.target);
        if(e)e.frequency=(e.frequency||1)+1;else memory.errors.push({type:a.type||'other',original:a.original,target:a.target,frequency:1});
        memory.errors=memory.errors.slice(-20);
      }
      saveMemory();responses.push({id:fc.id,name:fc.name,response:{result:'ok'}});
    }catch{responses.push({id:fc.id,name:fc.name,response:{result:'error'}})}
  }
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({toolResponse:{functionResponses:responses}}));
  toolBusy=false;
}
async function parseFrame(raw){
  if(raw instanceof Blob)raw=await raw.text();
  else if(raw instanceof ArrayBuffer)raw=new TextDecoder().decode(raw);
  return JSON.parse(String(raw));
}
function startMic(){
  if(processor||!audioCtx||!stream)return;
  source=audioCtx.createMediaStreamSource(stream);
  processor=audioCtx.createScriptProcessor(4096,1,1);
  const sink=audioCtx.createGain();sink.gain.value=0;
  processor.onaudioprocess=e=>{
    if(muted||toolBusy||!setupDone||ws?.readyState!==WebSocket.OPEN)return;
    const mono=e.inputBuffer.getChannelData(0),pcm=resample(mono,audioCtx.sampleRate,16000);
    ws.send(JSON.stringify({realtimeInput:{audio:{data:b64(floatToPCM16(pcm)),mimeType:'audio/pcm;rate=16000'}}}));
  };
  source.connect(processor);processor.connect(sink);sink.connect(audioCtx.destination);
}
function closeSocketOnly(){
  const old=ws;ws=null;setupDone=false;
  try{old?.close(1000,'Reconnect')}catch{}
}
function scheduleReconnect(delay=300){
  if(!shouldStayConnected||reconnectTimer)return;
  setState('reconnecting');
  reconnectTimer=setTimeout(async()=>{
    reconnectTimer=null;
    if(!shouldStayConnected)return;
    try{await connectSocket(true)}
    catch(e){
      showError(`Đang thử nối lại: ${e?.message||e}`);
      scheduleReconnect(1200);
    }
  },delay);
}
async function connectSocket(resume=false){
  if(reconnecting)return;
  reconnecting=true;
  try{
    if(!currentToken)currentToken=await mintToken(getApiKey());
    const endpoint=`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(currentToken)}`;
    const sock=new WebSocket(endpoint);
    ws=sock;
    await new Promise((resolve,reject)=>{
      let settled=false;
      sock.onopen=()=>{sock.send(JSON.stringify(setupPayload(resume?resumeHandle:'')));};
      sock.onerror=()=>{if(!settled){settled=true;reject(new Error('Không kết nối được Gemini Live.'))}};
      sock.onmessage=async ev=>{
        let msg;try{msg=await parseFrame(ev.data)}catch{return}

        if(msg.setupComplete){
          setupDone=true;
          if(!processor)startMic();
          setState('listening');muteBtn.disabled=false;endBtn.disabled=false;
          if(!settled){settled=true;resolve()}
          if(!startedOnce){
            startedOnce=true;
            sock.send(JSON.stringify({realtimeInput:{text:`Begin naturally now. Greet ${childName()} briefly and invite her to talk, ask something, play a tiny game, or hear a short story. She may use Vietnamese, English, or both. Keep the first turn short.`}}));
          }
        }

        if(msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate?.newHandle){
          resumeHandle=msg.sessionResumptionUpdate.newHandle;
        }

        if(msg.goAway){
          scheduleReconnect(150);
        }

        if(msg.toolCall)await handleToolCall(msg.toolCall);

        const sc=msg.serverContent;if(!sc)return;
        if(sc.interrupted){stopPlayback();setState('listening')}
        if(sc.inputTranscription?.text){
          if(lastSpeaker!==childName())userCaption='';
          userCaption+=sc.inputTranscription.text;showCaption(childName(),userCaption);setState('listening');
        }
        if(sc.outputTranscription?.text){
          if(lastSpeaker!=='Cô Giáo Mini')miniCaption='';
          miniCaption+=sc.outputTranscription.text;showCaption('Cô Giáo Mini',miniCaption);setState('speaking');
        }
        for(const p of sc.modelTurn?.parts||[]){
          if(p.inlineData?.data&&String(p.inlineData?.mimeType||'').startsWith('audio/pcm'))playPCM24(p.inlineData.data);
        }
        if(sc.turnComplete){
          userCaption='';miniCaption='';
          if(playTime<=audioCtx.currentTime+.03)setState('listening');
        }
      };
      sock.onclose=e=>{
        setupDone=false;
        if(!settled){settled=true;reject(new Error(`Gemini đóng kết nối (${e.code}) ${e.reason||''}`))}
        if(shouldStayConnected && e.code!==1000)scheduleReconnect(350);
      };
    });
  }finally{reconnecting=false}
}

async function start(){
  clearError();
  const apiKey=getApiKey();
  if(!apiKey){settingsDialog.showModal();throw new Error('Hãy nhập Gemini API key trước.')}
  talkBtn.disabled=true;setState('connecting');shouldStayConnected=true;startedOnce=false;resumeHandle='';currentToken='';
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();await audioCtx.resume();
  await connectSocket(false);
}
async function end(update=true){
  shouldStayConnected=false;setupDone=false;toolBusy=false;muted=false;startedOnce=false;
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
  stopPlayback();
  try{processor?.disconnect();source?.disconnect()}catch{}
  try{processor&&(processor.onaudioprocess=null)}catch{}
  try{stream?.getTracks().forEach(t=>t.stop())}catch{}
  try{ws?.close(1000,'End')}catch{}
  try{await audioCtx?.close()}catch{}
  ws=stream=audioCtx=source=processor=null;playTime=0;currentToken='';resumeHandle='';reconnecting=false;
  if(update){setState('idle');talkBtn.disabled=false;muteBtn.disabled=true;endBtn.disabled=true;muteBtn.textContent='Mic: On'}
}

talkBtn.addEventListener('click',()=>start().catch(async e=>{showError(e);await end()}));
endBtn.addEventListener('click',()=>end());
muteBtn.addEventListener('click',()=>{
  muted=!muted;
  stream?.getAudioTracks().forEach(t=>t.enabled=!muted);
  muteBtn.textContent=muted?'Mic: Off':'Mic: On';
  if(muted&&setupDone&&ws?.readyState===WebSocket.OPEN){
    try{ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}))}catch{}
  }
});
settingsBtn.addEventListener('click',()=>{
  apiKeyInput.value=getApiKey();
  rememberKey.checked=!!localStorage.getItem(apiStorageKey);
  setSpeechRatePercent(speechRate*100);
  settingsDialog.showModal();
});
speechRateInput.addEventListener('input',()=>setSpeechRatePercent(speechRateInput.value));
saveKeyBtn.addEventListener('click',()=>{
  const v=apiKeyInput.value.trim();
  setSpeechRatePercent(speechRateInput.value);
  if(v){setApiKey(v,rememberKey.checked);settingsDialog.close();clearError()}
});
deleteKeyBtn.addEventListener('click',()=>{
  sessionStorage.removeItem(apiStorageKey);localStorage.removeItem(apiStorageKey);
  apiKeyInput.value='';rememberKey.checked=false;
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&audioCtx?.state==='suspended')audioCtx.resume().catch(()=>{});
});
setSpeechRatePercent(speechRate*100);
captionText.textContent=`Hello ${childName()}!`;
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
