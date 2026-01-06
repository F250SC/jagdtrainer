import { dbGetAll, dbPut, dbPutMany, dbGet, dbClear } from "./db.js";

const $ = (id) => document.getElementById(id);
const panels = { home: $("panelHome"), setup: $("panelSetup"), review: $("panelReview"), stats: $("panelStats") };

function showPanel(name){
  for (const [k,el] of Object.entries(panels)){
    const on = (k===name);
    el.classList.toggle("hidden", !on);
    el.setAttribute("aria-hidden", (!on).toString());
  }
}
function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const nowTs=()=>Date.now();
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function defaultState(id){ return { id, reps:0, intervalDays:0, ease:2.5, dueTs:0, lapses:0, lastRate:null, lastWasCorrect:null, updatedAt:0 }; }
const RATE_QUALITY={ again:0, hard:3, good:4, easy:5 };

function applySRS(state, rate){
  const q = RATE_QUALITY[rate] ?? 0;
  const newEase = clamp(state.ease + (0.1 - (5-q)*(0.08 + (5-q)*0.02)), 1.3, 2.8);
  let reps=state.reps, interval=state.intervalDays;
  if (q < 3){
    reps=0; interval=0; state.lapses=(state.lapses||0)+1;
    state.dueTs = nowTs() + 10*60*1000;
  } else {
    if (reps===0) interval=1;
    else if (reps===1) interval=6;
    else interval=Math.round(interval*newEase);
    if (rate==="hard") interval=Math.max(1,Math.round(interval*0.75));
    if (rate==="easy") interval=Math.round(interval*1.15);
    reps=reps+1;
    state.dueTs = nowTs() + interval*24*60*60*1000;
  }
  state.reps=reps; state.intervalDays=interval; state.ease=newEase; state.lastRate=rate; state.updatedAt=nowTs();
  return state;
}

const HELP_TEXT = `CSV (Semikolon oder Komma):\nsubject;question;options;correct;explanation(optional)\n\n- subject: z.B. SG4\n- options: z.B. "a) Text | b) Text | c) Text"\n- correct: z.B. "a" oder "a,c"\n- explanation: optional\n\nBeispiel:\nSG4;Wie heißt ...?;"a) ... | b) ... | c) ...";b;"kurze Eselsbrücke"\n\nJSON (Array von Karten):\n[\n  {\n    "subject":"SG4",\n    "question":"...",\n    "options":[{"k":"a","t":"..."},{"k":"b","t":"..."}],\n    "correct":["b"],\n    "explanation":"optional"\n  }\n]`;
$("formatHelp").textContent = HELP_TEXT;

let allCards=[]; let allState=new Map();
let settings={ sessionSize:30, mode:"exam", randomOrder:true, mixSubjects:true, subjectsOn:{} };
let session={ queue:[], idx:0, current:null, revealed:false, checked:false, picked:null, wasCorrect:null };

async function loadAll(){
  allCards = await dbGetAll("cards");
  const st = await dbGetAll("state");
  allState = new Map(st.map(s=>[s.id,s]));
  const s = await dbGet("settings","main");
  if (s?.value) settings = { ...settings, ...s.value };

  const subjects=[...new Set(allCards.map(c=>c.subject))].sort();
  for (const sub of subjects){ if (settings.subjectsOn[sub]===undefined) settings.subjectsOn[sub]=true; }
  for (const k of Object.keys(settings.subjectsOn)){ if (!subjects.includes(k)) delete settings.subjectsOn[k]; }
  await dbPut("settings",{ key:"main", value: settings });
}

function renderSubjects(){
  renderSubjectChips("subjectList");
  renderSubjectChips("subjectListHome");
}

function renderSubjectChips(containerId){
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = "";
  const subjects = [...new Set(allCards.map(c=>c.subject))].sort();
  if (!subjects.length){
    wrap.innerHTML = `<span class="muted">Noch keine Karten. Importiere CSV/JSON oder lade Sample.</span>`;
    return;
  }
  for (const sub of subjects){
    const on = !!settings.subjectsOn[sub];
    const btn = document.createElement("button");
    btn.className = "chip " + (on ? "on":"off");
    btn.textContent = sub;
    btn.onclick = async () => {
      settings.subjectsOn[sub] = !settings.subjectsOn[sub];
      await dbPut("settings",{ key:"main", value: settings });
      renderSubjects();
      await renderHome();
    };
    wrap.appendChild(btn);
  }
}

function writeSetupUI(){
  $("sessionSize").value = settings.sessionSize;
  $("mode").value = settings.mode;
  $("randomOrder").checked = settings.randomOrder;
  $("mixSubjects").checked = settings.mixSubjects;

  // Home
  if ($("homeSessionSize")) $("homeSessionSize").value = settings.sessionSize;
  if ($("homeRandomOrder")) $("homeRandomOrder").checked = settings.randomOrder;
  if ($("homeMixSubjects")) $("homeMixSubjects").checked = settings.mixSubjects;
  if ($("dailyGoal")) $("dailyGoal").value = settings.dailyGoal || 50;
}
function readSetupUI(){
  settings.sessionSize = clamp(parseInt($("sessionSize").value || "30",10), 5, 200);
  settings.mode = $("mode").value;
  settings.randomOrder = $("randomOrder").checked;
  settings.mixSubjects = $("mixSubjects").checked;
  if ($("dailyGoal")) settings.dailyGoal = clamp(parseInt($("dailyGoal").value || "50",10), 5, 500);
}

function readHomeUI(){
  if ($("homeSessionSize")) settings.sessionSize = clamp(parseInt($("homeSessionSize").value || "30",10), 5, 200);
  if ($("homeRandomOrder")) settings.randomOrder = $("homeRandomOrder").checked;
  if ($("homeMixSubjects")) settings.mixSubjects = $("homeMixSubjects").checked;
  if ($("dailyGoal")) settings.dailyGoal = clamp(parseInt($("dailyGoal").value || "50",10), 5, 500);
}
async function saveSetupUI(){ readSetupUI(); await dbPut("settings",{key:"main",value:settings}); }

async function saveHomeUI(){ readHomeUI(); await dbPut("settings",{key:"main",value:settings}); writeSetupUI(); }

function eligibleCards(){
  const subjects = Object.entries(settings.subjectsOn).filter(([,on])=>on).map(([k])=>k);
  return allCards.filter(c=>subjects.includes(c.subject));
}

function pickSessionQueue(){
  const cards=eligibleCards();
  const t=nowTs(); const due=[], learning=[], fresh=[];
  for (const c of cards){
    const st=allState.get(c.id) || defaultState(c.id);
    if (!allState.has(c.id)) allState.set(c.id, st);
    if (!st.dueTs) fresh.push(c);
    else if (st.dueTs<=t) due.push(c);
    else learning.push(c);
  }
  shuffle(due); shuffle(fresh); shuffle(learning);
  const size=settings.sessionSize; const queue=[];
  const dueTarget=Math.min(due.length, Math.round(size*0.7));
  const newTarget=Math.min(fresh.length, size-dueTarget);
  while(queue.length<dueTarget && due.length) queue.push(due.shift());
  while(queue.length<dueTarget+newTarget && fresh.length) queue.push(fresh.shift());
  while(queue.length<size && due.length) queue.push(due.shift());
  while(queue.length<size && fresh.length) queue.push(fresh.shift());
  while(queue.length<size && learning.length) queue.push(learning.shift());

  if (!settings.mixSubjects){
    const by=new Map();
    for (const c of queue){ if(!by.has(c.subject)) by.set(c.subject,[]); by.get(c.subject).push(c); }
    const ordered=[];
    for (const sub of [...by.keys()].sort()){ const arr=by.get(sub); shuffle(arr); ordered.push(...arr); }
    return ordered.slice(0,size);
  }
  if (settings.randomOrder) shuffle(queue);
  return queue.slice(0,size);
}

function setReviewModeUI(){
  $("examArea").classList.toggle("hidden", settings.mode!=="exam");
  $("flashArea").classList.toggle("hidden", settings.mode!=="flash");
  $("rateRow").classList.add("hidden");
  $("resultLine").textContent="";
  $("answerBox").classList.add("hidden");
}

function updateProgress(){
  const total=session.queue.length, done=session.idx;
  $("progressText").textContent=`${done} / ${total}`;
  $("barFill").style.width = total ? `${Math.round((done/total)*100)}%` : "0%";
}

function renderCard(card){
  session.current=card; session.revealed=false; session.checked=false; session.picked=null; session.wasCorrect=null;
  $("pillSubject").textContent=card.subject||"SG";
  $("pillCardId").textContent=`#${card.id}`;
  $("qText").textContent=card.question;
  setReviewModeUI();

  if (settings.mode==="exam"){
    const list=$("optList"); list.innerHTML="";
    for (const opt of card.options){
      const label=document.createElement("label");
      label.className="opt";
      label.innerHTML = `<input type="radio" name="opt" value="${opt.k}"><div><strong>${opt.k})</strong> ${opt.t}</div>`;
      label.addEventListener("click", ()=>{ const input=label.querySelector("input"); input.checked=true; session.picked=input.value; });
      list.appendChild(label);
    }
    $("btnCheck").disabled=false;
    $("resultLine").textContent="Wähle eine Antwort und prüfe.";
  } else {
    $("btnReveal").disabled=false;
    $("answerBox").innerHTML="";
  }
}

function revealFlash(card){
  const box=$("answerBox"); box.classList.remove("hidden");
  box.innerHTML = `<div class="ansTitle">Lösung</div>` + card.correct.map(k=>{
    const t=card.options.find(o=>o.k===k)?.t ?? "";
    return `<div class="ansItem"><strong>${k})</strong> ${t}</div>`;
  }).join("") + (card.explanation ? `<div class="divider"></div><div class="muted">${escapeHtml(card.explanation)}</div>`:"");
  session.revealed=true; $("rateRow").classList.remove("hidden");
}

function checkExam(card){
  if (!session.picked) return;
  session.checked=true;
  const correctSet=new Set(card.correct);
  const els=[...document.querySelectorAll("#optList .opt")];
  for (const el of els){
    const v=el.querySelector("input").value;
    el.classList.remove("correct","wrong");
    if (correctSet.has(v)) el.classList.add("correct");
    if (session.picked===v && !correctSet.has(v)) el.classList.add("wrong");
  }
  const ok=correctSet.has(session.picked);
  session.wasCorrect=ok;
  $("resultLine").textContent = ok ? "✅ Richtig. Jetzt bewerten (Hard/Good/Easy)." : "❌ Falsch. Für den Lernplan: Again.";
  $("rateRow").classList.remove("hidden");
  if (!ok) document.querySelector('[data-rate="again"]')?.focus();
}

function escapeHtml(s){ return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

async function ensureCardState(card){
  let st=allState.get(card.id);
  if (!st){ st=defaultState(card.id); allState.set(card.id, st); await dbPut("state", st); }
  return st;
}

async function bumpStats({rate, wasCorrect}){
  const day=todayKey();
  const cur=(await dbGet("stats", day)) || { day, done:0, correct:0, wrong:0, again:0, hard:0, good:0, easy:0 };
  cur.done+=1;
  if (wasCorrect===true) cur.correct+=1;
  if (wasCorrect===false) cur.wrong+=1;
  if (rate && cur[rate]!==undefined) cur[rate]+=1;
  await dbPut("stats", cur);
}

async function rateCurrent(rate){
  const card=session.current; if(!card) return;
  let wasCorrect=session.wasCorrect;
  if (settings.mode==="flash") wasCorrect = (rate==="again") ? false : true;
  else if (!session.checked) return;

  const st=await ensureCardState(card);
  st.lastWasCorrect=wasCorrect;
  applySRS(st, rate);
  await dbPut("state", st);
  await bumpStats({ rate, wasCorrect });

  session.idx+=1; updateProgress();
  if (session.idx>=session.queue.length){
    $("subtitle").textContent="Durchgang beendet – Stats anschauen?";
    showPanel("stats"); await renderStats(); return;
  }
  renderCard(session.queue[session.idx]);
}

async function startSession(forcedMode){
  // Start from Home or Setup. Home can force mode (flash/exam).
  if (forcedMode) settings.mode = forcedMode;

  const homeVisible = panels.home && !panels.home.classList.contains("hidden");
  if (homeVisible){
    await saveHomeUI();
  } else {
    await saveSetupUI();
  }

  if (!Object.entries(settings.subjectsOn).some(([,v])=>v)){
    alert("Bitte mindestens ein Sachgebiet aktivieren.");
    return;
  }

  session.queue = pickSessionQueue();
  session.idx = 0;

  if (!session.queue.length){
    alert("Keine Karten gefunden. Bitte importieren oder Sample laden.");
    return;
  }

  $("subtitle").textContent = (settings.mode === "exam") ? "Prüfung läuft…" : "Lernkarten laufen…";
  showPanel("review");
  updateProgress();
  renderCard(session.queue[0]);
}

async function renderHome(){
  const day = todayKey();
  const s = (await dbGet("stats", day)) || { done:0, correct:0, wrong:0 };
  const done = s.done || 0;
  const correct = s.correct || 0;
  const acc = done ? Math.round((correct/done)*100) : 0;

  if ($("homeDone")) $("homeDone").textContent = done;
  if ($("homeAcc")) $("homeAcc").textContent = `${acc}%`;

  const goal = settings.dailyGoal || 50;
  const reached = done >= goal;
  if ($("homeGoalState")) $("homeGoalState").textContent = reached ? "✅" : "⏳";
  const pct = goal ? Math.min(100, Math.round((done/goal)*100)) : 0;
  if ($("homeGoalBar")) $("homeGoalBar").style.width = `${pct}%`;
  if ($("homeGoalText")) $("homeGoalText").textContent = `${done} / ${goal}`;
}

async function renderStats(){
  const day=todayKey();
  const s=(await dbGet("stats", day)) || { done:0, correct:0, wrong:0, again:0, hard:0, good:0, easy:0 };
  $("sTodayDone").textContent=s.done||0;
  $("sTodayCorrect").textContent=s.correct||0;
  $("sTodayWrong").textContent=s.wrong||0;
  $("sTodayAcc").textContent = s.done ? `${Math.round((s.correct/s.done)*100)}%` : "0%";
  $("sAgain").textContent=s.again||0; $("sHard").textContent=s.hard||0; $("sGood").textContent=s.good||0; $("sEasy").textContent=s.easy||0;
  $("sTotalCards").textContent=allCards.length;

  const t=nowTs(); let learned=0,due=0,fresh=0;
  for (const c of allCards){
    const st=allState.get(c.id);
    if (!st || !st.dueTs){ fresh++; continue; }
    learned++; if (st.dueTs<=t) due++;
  }
  $("sLearned").textContent=learned; $("sDue").textContent=due; $("sNew").textContent=fresh;
}

function stableId(subject, question){
  const s=`${subject}||${question}`;
  let h=2166136261;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function normalizeCard(c){
  if (c.options && Array.isArray(c.options)){
    return {
      id: c.id || stableId(c.subject||"SG?", c.question||""),
      subject: (c.subject||"SG?").trim(),
      question: (c.question||"").trim(),
      options: c.options.map(o=>({ k:String(o.k).trim().toLowerCase(), t:String(o.t).trim() })),
      correct: (c.correct||[]).map(x=>String(x).trim().toLowerCase()),
      explanation: c.explanation ? String(c.explanation).trim() : ""
    };
  }
  const subject=String(c.subject||"SG?").trim();
  const question=String(c.question||"").trim();
  const optionsText=String(c.options||"");
  const options=optionsText.split("|").map(s=>s.trim()).filter(Boolean).map(s=>{
    const m=s.match(/^([a-z])\)\s*(.*)$/i);
    return m ? { k:m[1].toLowerCase(), t:m[2].trim() } : { k:"?", t:s };
  });
  const correct=String(c.correct||"").split(/[\s,]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  const explanation=c.explanation ? String(c.explanation).trim() : "";
  return { id: stableId(subject, question), subject, question, options, correct, explanation };
}

function splitCSVLine(line, delim){
  const out=[]; let cur=""; let inQ=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ cur+='"'; i++; }
      else inQ=!inQ;
      continue;
    }
    if (!inQ && ch===delim){ out.push(cur); cur=""; continue; }
    cur+=ch;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}

function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
  if (!lines.length) return [];
  const sample=lines.slice(0,3).join("\n");
  const delim = (sample.split(";").length >= sample.split(",").length) ? ";" : ",";
  const rows=lines.map(l=>splitCSVLine(l, delim));
  const header=rows[0].map(h=>h.trim().toLowerCase());
  const hasHeader=header.includes("subject") || header.includes("question");
  const data=hasHeader ? rows.slice(1) : rows;
  const out=[];
  for (const r of data){
    const [subject,question,options,correct,explanation]=r;
    if (!question) continue;
    out.push({ subject, question, options, correct, explanation });
  }
  return out;
}

async function importCardsFromText(text, ext){
  let cards=[];
  if (ext==="json"){
    const raw=JSON.parse(text);
    cards=raw.map(c=>normalizeCard(c));
  } else {
    cards=parseCSV(text).map(c=>normalizeCard(c));
  }
  await dbPutMany("cards", cards);
  await loadAll();
  renderSubjects();
  alert(`Import ok: ${cards.length} Karten.`);
}

// Sample deck
const SAMPLE=[
  { subject:"SG4", question:"Welche Aussage trifft zu? (Sample)", options:[{k:"a",t:"Option A"},{k:"b",t:"Option B"},{k:"c",t:"Option C"}], correct:["b"], explanation:"Nur ein Sample – importiere eure echten Karten als CSV/JSON." },
  { subject:"SG4", question:"Bei welcher Bewertung wird die Karte nach ~10 Minuten wieder fällig?", options:[{k:"a",t:"Again"},{k:"b",t:"Hard"},{k:"c",t:"Easy"}], correct:["a"], explanation:"Again setzt die Karte auf sehr kurze Wiederholung." },
  { subject:"SG1", question:"Wie heißt die App? (Sample)", options:[{k:"a",t:"Jagdtrainer Bayern"},{k:"b",t:"Anki Pro"},{k:"c",t:"QuizX"}], correct:["a"], explanation:"Branding kannst du später ändern." },
  { subject:"SG2", question:"Karten kommen standardmäßig in welcher Reihenfolge?", options:[{k:"a",t:"Alphabetisch"},{k:"b",t:"Zufällig"},{k:"c",t:"Nach ID"}], correct:["b"], explanation:"Zufällig, damit keine Reihenfolge gelernt wird." },
  { subject:"SG3", question:"Welche beiden Hosting-Optionen wolltest du nutzen?", options:[{k:"a",t:"GitHub Pages"},{k:"b",t:"Home Assistant"},{k:"c",t:"Beides ist ok"}], correct:["a","b","c"], explanation:"Genau 🙂" }
];

async function loadSample(){
  const cards=SAMPLE.map(c=>normalizeCard(c));
  await dbPutMany("cards", cards);
  await loadAll(); renderSubjects();
  alert("Sample geladen. Jetzt Durchgang starten.");
}

async function resetAll(){
  if (!confirm("Wirklich alles löschen? Karten, Lernstand, Stats.")) return;
  await dbClear("cards"); await dbClear("state"); await dbClear("stats");
  settings.subjectsOn={}; await dbPut("settings",{key:"main",value:settings});
  await loadAll(); renderSubjects(); writeSetupUI();
  alert("Zurückgesetzt.");
}

// Wire UI
$("btnStart").onclick = () => startSession();
$("btnStartLearn").onclick = () => startSession("flash");
$("btnStartExam").onclick = () => startSession("exam");
$("btnBackToSetup").onclick = async () => { await saveSetupUI(); await renderHome(); showPanel("home"); $("subtitle").textContent = "Startseite"; };
$("btnSettings").onclick = async () => { await saveSetupUI(); showPanel("setup"); $("subtitle").textContent = "Setup"; };
$("btnHome").onclick = async () => { await saveHomeUI(); await renderHome(); showPanel("home"); $("subtitle").textContent = "Startseite"; };
$("btnStats").onclick = async () => { await renderStats(); await renderHome(); showPanel("stats"); $("subtitle").textContent = "Statistiken"; };
$("btnStatsBack").onclick = async () => { await renderHome(); showPanel("home"); $("subtitle").textContent = "Startseite"; };

$("btnReveal").onclick=()=>revealFlash(session.current);
$("btnCheck").onclick=()=>checkExam(session.current);

document.querySelectorAll(".btn.rate").forEach(btn=>btn.addEventListener("click", async()=>{
  const rate=btn.getAttribute("data-rate"); await rateCurrent(rate);
}));

document.addEventListener("keydown", async(e)=>{
  if (panels.review.classList.contains("hidden")) return;
  if (e.key==="Enter"){
    if (settings.mode==="exam"){ if(!session.checked) checkExam(session.current); }
    else { if(!session.revealed) revealFlash(session.current); }
  }
  if (["1","2","3","4"].includes(e.key)){
    const map={ "1":"again","2":"hard","3":"good","4":"easy" };
    if (settings.mode==="exam" && !session.checked) return;
    if (settings.mode==="flash" && !session.revealed) return;
    await rateCurrent(map[e.key]);
  }
});

$("fileImport").addEventListener("change", async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  const ext=file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
  const text=await file.text();
  try{ await importCardsFromText(text, ext); } catch(err){ console.error(err); alert("Import fehlgeschlagen: "+(err?.message||err)); }
  e.target.value="";
});

$("btnImportSample").onclick=loadSample;
$("btnResetAll").onclick=resetAll;

["sessionSize","mode","randomOrder","mixSubjects"].forEach(id=>$(id).addEventListener("change", async()=>{ await saveSetupUI(); }));

// Home autosave
["homeSessionSize","homeRandomOrder","homeMixSubjects","dailyGoal"].forEach(id=>{
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", async()=>{ await saveHomeUI(); await renderHome(); });
});

async function registerSW(){
  const swState = $("swState");
  const btnUpdate = $("btnUpdate");

  if (!("serviceWorker" in navigator)){
    if (swState) swState.textContent = "Kein Service Worker";
    if (btnUpdate) btnUpdate.disabled = true;
    return;
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    // New SW took control → reload once.
    location.reload();
  });

  const setBtn = (label, mode) => {
    if (!btnUpdate) return;
    btnUpdate.textContent = label;
    btnUpdate.dataset.mode = mode; // "check" | "install"
    btnUpdate.disabled = false;
  };

  const setState = (t) => { if (swState) swState.textContent = t; };

  // Register once (normal URL). We'll force-update with cache-bust on demand.
  let reg;
  try{
    reg = await navigator.serviceWorker.register("./sw.js");
    setState("Offline bereit");
  } catch(e){
    console.warn(e);
    setState("SW Fehler");
    if (btnUpdate) btnUpdate.disabled = true;
    return;
  }

  // If an update is already waiting (rare), offer install immediately.
  if (reg.waiting){
    setState("Update verfügbar");
    setBtn("Update installieren", "install");
  } else {
    setBtn("Auf Update prüfen", "check");
  }

  // Track installing worker when update is found
  let pendingWorker = null;

  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    if (!w) return;
    pendingWorker = w;
    setState("Update wird geladen…");
    w.addEventListener("statechange", () => {
      // If installed and we already have a controller, it's an update waiting to activate.
      if (w.state === "installed" && navigator.serviceWorker.controller){
        setState("Update verfügbar");
        setBtn("Update installieren", "install");
      }
      // First install (no controller yet)
      if (w.state === "activated" && !navigator.serviceWorker.controller){
        setState("Offline bereit");
      }
    });
  });

  async function forceCheck(){
    if (!btnUpdate) return;
    btnUpdate.disabled = true;
    setState("Prüfe Update…");

    try{
      // iOS/Safari can cache sw.js aggressively; re-register with a cache-busting query.
      const cb = Date.now();
      reg = await navigator.serviceWorker.register(`./sw.js?cb=${cb}`);
      await reg.update();

      // If a waiting worker exists right away, great:
      if (reg.waiting){
        setState("Update verfügbar");
        setBtn("Update installieren", "install");
        return;
      }

      // If installing, wait briefly for it to become installed/waiting
      const w = reg.installing || pendingWorker;
      if (w){
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 3500);
          const onChange = () => {
            if (w.state === "installed" || w.state === "redundant" || w.state === "activated"){
              clearTimeout(timeout);
              w.removeEventListener("statechange", onChange);
              resolve();
            }
          };
          w.addEventListener("statechange", onChange);
        });
      }

      if (reg.waiting){
        setState("Update verfügbar");
        setBtn("Update installieren", "install");
      } else {
        setState("Kein Update gefunden");
        setBtn("Auf Update prüfen", "check");
      }
    } catch(e){
      console.warn(e);
      setState("Update-Check fehlgeschlagen");
      setBtn("Auf Update prüfen", "check");
    }
  }

  async function installUpdate(){
    if (!btnUpdate) return;
    btnUpdate.disabled = true;
    setState("Installiere Update…");

    try{
      const w = reg.waiting;
      if (!w){
        // No waiting worker anymore; try check again
        setState("Kein Update bereit");
        setBtn("Auf Update prüfen", "check");
        return;
      }
      w.postMessage({ type: "SKIP_WAITING" });
      // controllerchange listener will reload.
      // If iOS fails to fire controllerchange, do a safety reload after a moment.
      setTimeout(() => {
        if (!refreshing) location.reload();
      }, 1500);
    } catch(e){
      console.warn(e);
      setState("Update fehlgeschlagen");
      setBtn("Auf Update prüfen", "check");
    }
  }

  if (btnUpdate){
    btnUpdate.addEventListener("click", async () => {
      const mode = btnUpdate.dataset.mode || "check";
      if (mode === "install") await installUpdate();
      else await forceCheck();
    });
  }
}

(async function init(){
  await loadAll();
  writeSetupUI();
  renderSubjects();
  await renderStats();
  await renderHome();
  await registerSW();
  showPanel("home");
  $("subtitle").textContent = "Startseite";
})();
