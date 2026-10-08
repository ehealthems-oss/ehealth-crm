import { useState, useEffect } from "react";
import { supabase } from "./supabase";

// ─── Constants ───────────────────────────────────────────────────────────────
const SERVICES = ["EMS", "Bota de Compressão", "Banheira de Gelo", "Raio-X do Jogo"];
const LOCATIONS = ["In Home", "Racquet Club Terral", "Racquet Club Salve Arena"];
const STAGES = ["Lead", "Contato feito", "FUP", "Avaliação agendada", "Cliente ativo", "Inativo"];
const COLORS = {
  "Lead":"#c9a96e","Contato feito":"#1a3545","FUP":"#b05e1a",
  "Avaliação agendada":"#2a6b8a","Cliente ativo":"#2d7a4f","Inativo":"#888"
};
const gold="#c9a96e", navy="#0C1B33", cream="#F5F0E8";

const LESSON_STATUS = ["Realizada","Reagendada","Cancelada pelo cliente","Cancelada pelo profissional"];
const LESSON_STATUS_COLORS = {
  "Realizada":"#2d7a4f","Reagendada":"#b05e1a",
  "Cancelada pelo cliente":"#c0392b","Cancelada pelo profissional":"#888"
};

const EMPTY_ANAMNESE = { objectives:"", injuries:"", medications:"", restrictions:"", history:"", observations:"" };
const EMPTY_CLIENT = {
  name:"",phone:"",email:"",birthday:"",stage:"Lead",
  location:"In Home",services:[],notes:"",
  anamnese: EMPTY_ANAMNESE,
  assessments:[], lessons:[], touchpoints:[], tasks:[],
  avalDate:"", avalTime:""
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const locLabel = l => l==="In Home" ? "🏠 In Home" : l==="Racquet Club Terral" ? "🎾 Terral" : "🎾 Salve Arena";
const fmtDate = d => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const fmtDateShort = d => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "—";
const today = () => new Date().toISOString().split("T")[0];
const currentMonth = () => { const n=new Date(); return {m:n.getMonth(),y:n.getFullYear()}; };
const isThisMonth = dateStr => {
  if(!dateStr) return false;
  const d = new Date(dateStr+"T12:00:00");
  const {m,y} = currentMonth();
  return d.getMonth()===m && d.getFullYear()===y;
};
const daysUntil = dateStr => {
  if(!dateStr) return null;
  const d = new Date(dateStr+"T12:00:00");
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((d-now)/(1000*60*60*24));
};
const nextBirthdayDays = bdStr => {
  if(!bdStr) return null;
  const bd = new Date(bdStr+"T12:00:00");
  const now = new Date(); now.setHours(0,0,0,0);
  const yr = now.getFullYear();
  let next = new Date(yr, bd.getMonth(), bd.getDate());
  if(next < now) next = new Date(yr+1, bd.getMonth(), bd.getDate());
  return Math.round((next-now)/(1000*60*60*24));
};
const nextAssessmentDate = (c) => {
  if(!c.assessments?.length) return null;
  const sorted = [...c.assessments].sort((a,b)=>a.date>b.date?-1:1);
  const last = sorted[0];
  if(!last?.date) return null;
  const d = new Date(last.date+"T12:00:00");
  d.setMonth(d.getMonth()+3);
  return d.toISOString().split("T")[0];
};
const getAge = bdStr => {
  if(!bdStr) return null;
  const bd = new Date(bdStr+"T12:00:00");
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if(m<0||(m===0&&now.getDate()<bd.getDate())) age--;
  return age;
};

// ─── UI Components ────────────────────────────────────────────────────────────
function Badge({stage}){
  return <span style={{background:COLORS[stage]+"22",color:COLORS[stage],border:"1px solid "+COLORS[stage]+"55",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{stage}</span>;
}

function Modal({title,onClose,children,wide}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:cream,borderRadius:14,width:"100%",maxWidth:wide?860:560,boxShadow:"0 8px 40px rgba(0,0,0,0.25)",marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 24px 14px",borderBottom:"1px solid #e0d8cc",position:"sticky",top:0,background:cream,borderRadius:"14px 14px 0 0",zIndex:1}}>
          <span style={{fontWeight:700,fontSize:17,color:navy}}>{title}</span>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#888",lineHeight:1}}>✕</button>
        </div>
        <div style={{padding:"20px 24px 28px"}}>{children}</div>
      </div>
    </div>
  );
}

function Inp({label,value,onChange,type="text",placeholder="",disabled=false,half}){
  return(
    <div style={{marginBottom:13,flex:half?"1":"unset"}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#2a2218",marginBottom:4}}>{label}</label>}
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{width:"100%",padding:"8px 12px",border:"1px solid #c9b89a",borderRadius:8,fontSize:14,background:disabled?"#f0ebe0":"#fffdf8",color:"#2a2218",boxSizing:"border-box",outline:"none"}}/>
    </div>
  );
}

function Sel({label,value,onChange,options}){
  return(
    <div style={{marginBottom:13}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#2a2218",marginBottom:4}}>{label}</label>}
      <select value={value||""} onChange={e=>onChange(e.target.value)}
        style={{width:"100%",padding:"8px 12px",border:"1px solid #c9b89a",borderRadius:8,fontSize:14,background:"#fffdf8",color:"#2a2218",boxSizing:"border-box",outline:"none"}}>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TA({label,value,onChange,rows=3,placeholder=""}){
  return(
    <div style={{marginBottom:13}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#2a2218",marginBottom:4}}>{label}</label>}
      <textarea value={value||""} onChange={e=>onChange(e.target.value)} rows={rows} placeholder={placeholder}
        style={{width:"100%",padding:"8px 12px",border:"1px solid #c9b89a",borderRadius:8,fontSize:14,background:"#fffdf8",color:"#2a2218",boxSizing:"border-box",outline:"none",resize:"vertical"}}/>
    </div>
  );
}

function MC({label,options,selected,onChange}){
  return(
    <div style={{marginBottom:13}}>
      {label&&<label style={{display:"block",fontSize:12,fontWeight:600,color:"#2a2218",marginBottom:6}}>{label}</label>}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {options.map(o=>(
          <button key={o} onClick={()=>onChange(selected?.includes(o)?selected.filter(x=>x!==o):[...(selected||[]),o])}
            style={{padding:"5px 12px",borderRadius:20,border:"1px solid",borderColor:(selected||[]).includes(o)?gold:"#c9b89a",background:(selected||[]).includes(o)?gold+"33":"#fffdf8",fontSize:13,cursor:"pointer",fontWeight:(selected||[]).includes(o)?700:400,color:(selected||[]).includes(o)?"#7a5c1e":"#2a2218"}}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tabs({tabs,active,onChange}){
  return(
    <div style={{display:"flex",gap:0,borderBottom:"2px solid #e0d8cc",marginBottom:18,flexWrap:"wrap",overflowX:"auto"}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{padding:"8px 14px",border:"none",background:"none",cursor:"pointer",fontWeight:active===t.id?700:400,fontSize:13,color:active===t.id?navy:"#888",borderBottom:active===t.id?"2px solid "+navy:"2px solid transparent",marginBottom:-2,whiteSpace:"nowrap"}}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({children,action}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,borderBottom:"1px solid #e0d8cc",paddingBottom:8}}>
      <span style={{fontWeight:700,fontSize:14,color:navy}}>{children}</span>
      {action}
    </div>
  );
}

function AlertBadge({days,label}){
  if(days===null||days<0||days>30) return null;
  const urgent = days<=7;
  return(
    <span style={{background:urgent?"#ffeaea":"#fff8e8",color:urgent?"#c0392b":"#b05e1a",border:`1px solid ${urgent?"#f5c6c6":"#f0d080"}`,borderRadius:16,padding:"2px 8px",fontSize:11,fontWeight:600}}>
      {label} {days===0?"hoje":`em ${days}d`}
    </span>
  );
}

function Btn({children,onClick,primary,danger,disabled,sm}){
  return(
    <button onClick={onClick} disabled={disabled}
      style={{padding:sm?"5px 12px":"9px 18px",borderRadius:8,border:danger?"1px solid #fcc":"none",background:danger?"#fee":primary?navy:"#f0ebe0",color:danger?"#c0392b":primary?gold:"#2a2218",fontWeight:700,fontSize:sm?12:14,cursor:disabled?"default":"pointer",opacity:disabled?.5:1}}>
      {children}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CRM(){
  const [clients,setClients]=useState([]);
  const [search,setSearch]=useState("");
  const [filterStage,setFilterStage]=useState("Todos");
  const [view,setView]=useState("list");
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [subModal,setSubModal]=useState(null);
  const [sel,setSel]=useState(null);
  const [detailTab,setDetailTab]=useState("geral");
  const [form,setForm]=useState({...EMPTY_CLIENT,anamnese:{...EMPTY_ANAMNESE}});
  const [assessForm,setAssessForm]=useState({date:today(),professional:"",type:"Reavaliação",notes:"",nextDate:""});
  const [lessonForm,setLessonForm]=useState({date:today(),service:"EMS",professional:"",status:"Realizada",notes:""});
  const [touchForm,setTouchForm]=useState({date:today(),channel:"WhatsApp",direction:"Saída",summary:""});
  const [taskForm,setTaskForm]=useState({title:"",dueDate:"",done:false});
  const [pendingStage,setPendingStage]=useState(null);
  const [avalDate,setAvalDate]=useState("");
  const [avalTime,setAvalTime]=useState("");

  useEffect(()=>{
    (async()=>{
      const{data,error}=await supabase.from("clients").select("*").order("created_at",{ascending:false});
      if(data) setClients(data.map(normalizeClient));
      setLoading(false);
    })();
  },[]);

  const normalizeClient = c => ({
    ...EMPTY_CLIENT,...c,
    anamnese:c.anamnese||{...EMPTY_ANAMNESE},
    assessments:c.assessments||[],
    lessons:c.lessons||[],
    touchpoints:c.touchpoints||[],
    tasks:c.tasks||[],
    services:c.services||[],
  });

  // ── CRUD ──
  const upsert = async () => {
    const payload={...form};
    let data,error;
    if(form.id){
      ({data,error}=await supabase.from("clients").update(payload).eq("id",form.id).select());
      if(data) setClients(p=>p.map(c=>c.id===form.id?normalizeClient(data[0]):c));
    } else {
      ({data,error}=await supabase.from("clients").insert([payload]).select());
      if(data) setClients(p=>[normalizeClient(data[0]),...p]);
    }
    if(!error) setModal(null);
  };

  const del = async id => {
    await supabase.from("clients").delete().eq("id",id);
    setClients(p=>p.filter(c=>c.id!==id));
    setModal(null);
  };

  const updateSel = async updater => {
    const updated=updater(sel);
    const{data}=await supabase.from("clients").update(updated).eq("id",sel.id).select();
    if(data){ const n=normalizeClient(data[0]); setClients(p=>p.map(c=>c.id===sel.id?n:c)); setSel(n); }
  };

  const mv = async (id,stage) => {
    if(stage==="Avaliação agendada"){ setAvalDate(""); setAvalTime(""); setPendingStage({id,stage}); return; }
    const{data}=await supabase.from("clients").update({stage}).eq("id",id).select();
    if(data){ const n=normalizeClient(data[0]); setClients(p=>p.map(c=>c.id===id?n:c)); if(sel?.id===id) setSel(n); }
  };

  const confirmAval = async () => {
    if(!pendingStage) return;
    const{data}=await supabase.from("clients").update({stage:"Avaliação agendada",avalDate,avalTime}).eq("id",pendingStage.id).select();
    if(data){ const n=normalizeClient(data[0]); setClients(p=>p.map(c=>c.id===pendingStage.id?n:c)); if(sel?.id===pendingStage.id) setSel(n); }
    setPendingStage(null);
  };

  const ff = k => v => setForm(f=>({...f,[k]:v}));
  const fa = k => v => setForm(f=>({...f,anamnese:{...f.anamnese,[k]:v}}));

  const lessonStats = c => {
    const ls=(c.lessons||[]).filter(l=>isThisMonth(l.date));
    return {
      total:ls.length,
      done:ls.filter(l=>l.status==="Realizada").length,
      rescheduled:ls.filter(l=>l.status==="Reagendada").length,
      canceledClient:ls.filter(l=>l.status==="Cancelada pelo cliente").length,
      canceledPro:ls.filter(l=>l.status==="Cancelada pelo profissional").length,
    };
  };

  const filtered=clients.filter(c=>{
    const q=search.toLowerCase();
    return(!q||c.name.toLowerCase().includes(q)||(c.phone||"").includes(q))&&(filterStage==="Todos"||c.stage===filterStage);
  });

  const alerts=clients
    .filter(c=>c.stage==="Cliente ativo")
    .map(c=>({ c, bd:nextBirthdayDays(c.birthday), avalDays:daysUntil(nextAssessmentDate(c)), nextAval:nextAssessmentDate(c) }))
    .filter(x=>(x.bd!==null&&x.bd<=14)||(x.avalDays!==null&&x.avalDays<=14));

  const stats={
    total:clients.length,
    active:clients.filter(c=>c.stage==="Cliente ativo").length,
    fup:clients.filter(c=>c.stage==="FUP").length,
    leads:clients.filter(c=>c.stage==="Lead").length,
    pendingTasks:clients.reduce((s,c)=>s+(c.tasks||[]).filter(t=>!t.done).length,0),
    bdMonth:clients.filter(c=>{ const d=nextBirthdayDays(c.birthday); return d!==null&&d<=30; }).length,
  };

  if(loading) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"sans-serif",background:cream,color:navy,fontSize:16}}>
      Carregando e.Health CRM…
    </div>
  );

  // ── RENDER ──
  return(
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:cream,minHeight:"100vh",color:"#2a2218"}}>

      {/* Header */}
      <div style={{background:navy,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{color:gold,fontWeight:700,fontSize:18,letterSpacing:1}}>e.Health</div>
          <div style={{color:"#aab8c2",fontSize:11}}>CRM Técnico</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {[["list","☰ Lista"],["kanban","⬛ Funil"],["dashboard","◎ Painel"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)}
              style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",background:view===v?gold:"transparent",color:view===v?navy:"#aab8c2",fontWeight:600,fontSize:12}}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={()=>{setForm({...EMPTY_CLIENT,anamnese:{...EMPTY_ANAMNESE}});setModal("form");}}
          style={{background:gold,color:navy,border:"none",borderRadius:8,padding:"7px 16px",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          + Nova Cliente
        </button>
      </div>

      {/* ── DASHBOARD ── */}
      {view==="dashboard"&&(
        <div style={{padding:20,maxWidth:900,margin:"0 auto"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:16}}>
            {[{l:"Ativas",v:stats.active,c:"#2d7a4f"},{l:"FUP",v:stats.fup,c:"#b05e1a"},{l:"Leads",v:stats.leads,c:gold},{l:"Total",v:stats.total,c:navy},{l:"Tarefas",v:stats.pendingTasks,c:"#7a3b8a"},{l:"🎂 /30d",v:stats.bdMonth,c:"#e67e22"}].map(s=>(
              <div key={s.l} style={{background:"#fff",borderRadius:10,padding:"12px 14px",borderLeft:`3px solid ${s.c}`,boxShadow:"0 1px 4px #0001"}}>
                <div style={{fontSize:26,fontWeight:700,color:s.c}}>{s.v}</div>
                <div style={{fontSize:11,color:"#888",marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>

          {alerts.length>0&&(
            <div style={{background:"#fff",borderRadius:10,padding:16,marginBottom:14,boxShadow:"0 1px 4px #0001",borderTop:"3px solid #e74c3c"}}>
              <div style={{fontWeight:700,marginBottom:10,color:navy}}>🔔 Alertas</div>
              {alerts.map(({c,bd,avalDays})=>(
                <div key={c.id} onClick={()=>{setSel(c);setDetailTab("geral");setModal("detail");}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,background:"#f8f3ea",marginBottom:5,cursor:"pointer",border:"1px solid #e8dfc8"}}>
                  <span style={{flex:1,fontWeight:600,fontSize:13,color:navy}}>{c.name}</span>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {bd!==null&&bd<=14&&<AlertBadge days={bd} label="🎂"/>}
                    {avalDays!==null&&avalDays<=14&&<AlertBadge days={avalDays} label="📋 Aval."/>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{background:"#fff",borderRadius:10,padding:16,marginBottom:14,boxShadow:"0 1px 4px #0001"}}>
            <div style={{fontWeight:700,marginBottom:10,color:navy}}>📅 Aulas este mês</div>
            {clients.filter(c=>c.stage==="Cliente ativo"&&lessonStats(c).total>0).map(c=>{
              const s=lessonStats(c);
              return(
                <div key={c.id} onClick={()=>{setSel(c);setDetailTab("aulas");setModal("detail");}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:8,background:"#f8f3ea",marginBottom:4,cursor:"pointer"}}>
                  <span style={{flex:1,fontWeight:600,fontSize:13,color:navy}}>{c.name}</span>
                  <span style={{fontSize:12,color:"#2d7a4f",fontWeight:600}}>✅ {s.done}</span>
                  {s.rescheduled>0&&<span style={{fontSize:12,color:"#b05e1a",fontWeight:600}}>🔄 {s.rescheduled}</span>}
                  {(s.canceledClient+s.canceledPro)>0&&<span style={{fontSize:12,color:"#c0392b",fontWeight:600}}>❌ {s.canceledClient+s.canceledPro}</span>}
                </div>
              );
            })}
            {clients.filter(c=>c.stage==="Cliente ativo"&&lessonStats(c).total>0).length===0&&(
              <div style={{fontSize:13,color:"#aaa",textAlign:"center",padding:"8px 0"}}>Nenhuma aula registrada este mês.</div>
            )}
          </div>

          <div style={{background:"#fff",borderRadius:10,padding:16,boxShadow:"0 1px 4px #0001"}}>
            <div style={{fontWeight:700,marginBottom:10,color:navy}}>Funil</div>
            {STAGES.map(st=>{
              const n=clients.filter(c=>c.stage===st).length;
              const pct=clients.length?Math.round(n/clients.length*100):0;
              return(
                <div key={st} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}><span>{st}</span><span style={{fontWeight:600}}>{n}</span></div>
                  <div style={{background:"#eee",borderRadius:4,height:6}}><div style={{width:pct+"%",background:COLORS[st],height:6,borderRadius:4,transition:"width .3s"}}/></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── KANBAN ── */}
      {view==="kanban"&&(
        <div style={{padding:20,overflowX:"auto"}}>
          <div style={{display:"flex",gap:10,minWidth:900}}>
            {STAGES.map(stage=>{
              const cols=clients.filter(c=>c.stage===stage);
              return(
                <div key={stage} style={{flex:1,minWidth:140}}>
                  <div style={{background:COLORS[stage]+"1a",borderRadius:8,padding:"6px 10px",marginBottom:8,borderTop:"3px solid "+COLORS[stage]}}>
                    <span style={{fontWeight:700,fontSize:11,color:COLORS[stage]}}>{stage}</span>
                    <span style={{marginLeft:6,fontSize:10,color:"#888"}}>{cols.length}</span>
                  </div>
                  {cols.map(c=>{
                    const s=lessonStats(c);
                    const bd=nextBirthdayDays(c.birthday);
                    return(
                      <div key={c.id} onClick={()=>{setSel(c);setDetailTab("geral");setModal("detail");}}
                        style={{background:"#fff",borderRadius:8,padding:"10px 12px",marginBottom:6,cursor:"pointer",border:"1px solid #e8dfc8",boxShadow:"0 1px 3px #0001"}}>
                        <div style={{fontWeight:600,fontSize:12,color:navy,marginBottom:2}}>{c.name}</div>
                        <div style={{fontSize:10,color:"#888"}}>{locLabel(c.location)}</div>
                        {c.stage==="Avaliação agendada"&&c.avalDate&&(
                          <div style={{fontSize:10,color:"#2a6b8a",fontWeight:600,marginTop:3}}>📅 {fmtDateShort(c.avalDate)}{c.avalTime?" "+c.avalTime:""}</div>
                        )}
                        <div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap"}}>
                          {s.total>0&&<span style={{fontSize:10,color:"#2d7a4f"}}>✅{s.done} {s.rescheduled>0&&`🔄${s.rescheduled}`} {(s.canceledClient+s.canceledPro)>0&&`❌${s.canceledClient+s.canceledPro}`}</span>}
                          {bd!==null&&bd<=14&&<span style={{fontSize:10,color:"#e67e22",fontWeight:600}}>🎂{bd}d</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LIST ── */}
      {view==="list"&&(
        <div style={{padding:20,maxWidth:900,margin:"0 auto"}}>
          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <input placeholder="Buscar nome ou telefone…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{flex:1,minWidth:180,padding:"8px 14px",border:"1px solid #c9b89a",borderRadius:8,fontSize:14,background:"#fffdf8",outline:"none"}}/>
            <select value={filterStage} onChange={e=>setFilterStage(e.target.value)}
              style={{padding:"8px 14px",border:"1px solid #c9b89a",borderRadius:8,fontSize:14,background:"#fffdf8",outline:"none"}}>
              <option value="Todos">Todos</option>
              {STAGES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          {filtered.length===0?(
            <div style={{textAlign:"center",padding:48,color:"#aaa"}}>
              <div style={{fontSize:40,marginBottom:12}}>👤</div>
              <div style={{marginBottom:14}}>Nenhuma cliente.</div>
              <button onClick={()=>{setForm({...EMPTY_CLIENT,anamnese:{...EMPTY_ANAMNESE}});setModal("form");}}
                style={{background:gold,color:navy,border:"none",borderRadius:8,padding:"8px 20px",fontWeight:700,cursor:"pointer"}}>
                Adicionar primeira cliente
              </button>
            </div>
          ):filtered.map(c=>{
            const s=lessonStats(c);
            const bd=nextBirthdayDays(c.birthday);
            const avalD=daysUntil(nextAssessmentDate(c));
            return(
              <div key={c.id} onClick={()=>{setSel(c);setDetailTab("geral");setModal("detail");}}
                style={{background:"#fff",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 4px #0001",border:"1px solid #e8dfc8",cursor:"pointer",marginBottom:7}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:navy,display:"flex",alignItems:"center",justifyContent:"center",color:gold,fontWeight:700,fontSize:16,flexShrink:0}}>
                  {(c.name||"?")[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:14,color:navy}}>{c.name}</div>
                  <div style={{fontSize:11,color:"#888",marginTop:1}}>
                    {locLabel(c.location)}{c.phone?" · "+c.phone:""}
                    {(c.services||[]).length?" · "+(c.services||[]).join(", "):""}
                  </div>
                  {c.stage==="Avaliação agendada"&&c.avalDate&&(
                    <div style={{fontSize:11,color:"#2a6b8a",fontWeight:600,marginTop:2}}>📅 {fmtDate(c.avalDate)}{c.avalTime?" às "+c.avalTime:""}</div>
                  )}
                </div>
                <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  {s.done>0&&<span style={{fontSize:11,color:"#2d7a4f",fontWeight:600}}>✅{s.done}</span>}
                  {(s.canceledClient+s.canceledPro)>0&&<span style={{fontSize:11,color:"#c0392b",fontWeight:600}}>❌{s.canceledClient+s.canceledPro}</span>}
                  {bd!==null&&bd<=14&&<span style={{fontSize:11,color:"#e67e22",fontWeight:600}}>🎂{bd}d</span>}
                  {avalD!==null&&avalD<=14&&<span style={{fontSize:11,color:"#c0392b",fontWeight:600}}>📋{avalD}d</span>}
                  <Badge stage={c.stage}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL FORM (novo/editar) ── */}
      {modal==="form"&&(
        <Modal title={form.id?"Editar Cliente":"Nova Cliente"} onClose={()=>setModal(null)} wide>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            {/* Coluna 1: dados */}
            <div>
              <div style={{fontWeight:700,fontSize:13,color:navy,marginBottom:10,paddingBottom:6,borderBottom:"1px solid #e0d8cc"}}>Dados pessoais</div>
              <Inp label="Nome completo *" value={form.name} onChange={ff("name")}/>
              <div style={{display:"flex",gap:10}}>
                <Inp label="Telefone / WhatsApp" value={form.phone} onChange={ff("phone")} half/>
                <Inp label="E-mail" value={form.email} onChange={ff("email")} type="email" half/>
              </div>
              <Inp label="Data de aniversário" value={form.birthday} onChange={ff("birthday")} type="date"/>
              <Sel label="Status no funil" value={form.stage} onChange={ff("stage")} options={STAGES}/>
              <div style={{marginBottom:13}}>
                <label style={{display:"block",fontSize:12,fontWeight:600,marginBottom:6}}>Local</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {LOCATIONS.map(loc=>(
                    <button key={loc} onClick={()=>ff("location")(loc)}
                      style={{flex:1,minWidth:80,padding:"7px 4px",borderRadius:8,border:"2px solid",borderColor:form.location===loc?gold:"#c9b89a",background:form.location===loc?gold+"22":"#fffdf8",fontWeight:form.location===loc?700:400,fontSize:11,cursor:"pointer",color:form.location===loc?"#7a5c1e":"#2a2218"}}>
                      {locLabel(loc)}
                    </button>
                  ))}
                </div>
              </div>
              <MC label="Serviços" options={SERVICES} selected={form.services} onChange={ff("services")}/>
              <TA label="Observações gerais" value={form.notes} onChange={ff("notes")} rows={2}/>
            </div>
            {/* Coluna 2: anamnese */}
            <div>
              <div style={{fontWeight:700,fontSize:13,color:navy,marginBottom:10,paddingBottom:6,borderBottom:"1px solid #e0d8cc"}}>Anamnese</div>
              <TA label="Objetivos do cliente" value={form.anamnese.objectives} onChange={fa("objectives")} rows={2} placeholder="O que busca alcançar…"/>
              <TA label="Lesões e histórico de dores" value={form.anamnese.injuries} onChange={fa("injuries")} rows={2} placeholder="Lesões anteriores, cirurgias…"/>
              <TA label="Medicamentos em uso" value={form.anamnese.medications} onChange={fa("medications")} rows={2} placeholder="Medicamentos contínuos…"/>
              <TA label="Restrições / contraindicações" value={form.anamnese.restrictions} onChange={fa("restrictions")} rows={2} placeholder="Restrições médicas…"/>
              <TA label="Histórico de atividade física" value={form.anamnese.history} onChange={fa("history")} rows={2} placeholder="Prática anterior, frequência…"/>
              <TA label="Observações do profissional" value={form.anamnese.observations} onChange={fa("observations")} rows={2} placeholder="Anotações livres…"/>
            </div>
          </div>
          <div style={{display:"flex",gap:10,marginTop:10,justifyContent:"flex-end"}}>
            {form.id&&<button onClick={()=>del(form.id)} style={{background:"#fee",color:"#c0392b",border:"1px solid #fcc",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:600}}>Excluir</button>}
            <button onClick={()=>setModal(null)} style={{background:"#f0ebe0",color:"#555",border:"none",borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:600}}>Cancelar</button>
            <button onClick={upsert} disabled={!form.name} style={{background:navy,color:gold,border:"none",borderRadius:8,padding:"9px 24px",fontWeight:700,fontSize:15,cursor:"pointer",opacity:form.name?1:.5}}>Salvar</button>
          </div>
        </Modal>
      )}
      {/* ── MODAL DETAIL ── */}
      {modal==="detail"&&sel&&(
        <Modal title={sel.name} onClose={()=>setModal(null)} wide>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <Badge stage={sel.stage}/>
            <span style={{background:gold+"22",color:"#7a5c1e",border:"1px solid "+gold+"55",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:600}}>{locLabel(sel.location)}</span>
            {(sel.services||[]).map(s=><span key={s} style={{background:"#f0ebe0",borderRadius:20,padding:"2px 10px",fontSize:12,border:"1px solid #ddd"}}>{s}</span>)}
            {nextBirthdayDays(sel.birthday)!==null&&nextBirthdayDays(sel.birthday)<=14&&<AlertBadge days={nextBirthdayDays(sel.birthday)} label="🎂"/>}
            {nextAssessmentDate(sel)&&daysUntil(nextAssessmentDate(sel))<=14&&<AlertBadge days={daysUntil(nextAssessmentDate(sel))} label="📋 Avaliação"/>}
          </div>

          {/* Funil rápido */}
          <div style={{marginBottom:14,background:"#f8f3ea",borderRadius:8,padding:"10px 12px"}}>
            <div style={{fontSize:11,fontWeight:600,color:"#888",marginBottom:6}}>MOVER NO FUNIL</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {STAGES.map(st=>(
                <button key={st} onClick={()=>mv(sel.id,st)}
                  style={{padding:"3px 10px",borderRadius:20,border:"1px solid",borderColor:sel.stage===st?COLORS[st]:"#ddd",background:sel.stage===st?COLORS[st]+"22":"#fff",color:sel.stage===st?COLORS[st]:"#888",fontSize:11,cursor:"pointer",fontWeight:sel.stage===st?700:400}}>
                  {st}
                </button>
              ))}
            </div>
          </div>

          <Tabs active={detailTab} onChange={setDetailTab} tabs={[
            {id:"geral",label:"Geral"},
            {id:"anamnese",label:"Anamnese"},
            {id:"avaliacoes",label:`Avaliações (${(sel.assessments||[]).length})`},
            {id:"aulas",label:`Aulas`},
            {id:"touchpoints",label:`Contatos (${(sel.touchpoints||[]).length})`},
            {id:"tarefas",label:`Tarefas (${(sel.tasks||[]).filter(t=>!t.done).length})`},
          ]}/>

          {/* TAB GERAL */}
          {detailTab==="geral"&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px",fontSize:13,marginBottom:14}}>
                {sel.phone&&<div><span style={{color:"#888"}}>📱 </span><a href={`https://wa.me/55${sel.phone.replace(/\D/g,"")}`} target="_blank" style={{color:navy,textDecoration:"none",fontWeight:600}}>{sel.phone}</a></div>}
                {sel.email&&<div><span style={{color:"#888"}}>✉️ </span>{sel.email}</div>}
                {sel.birthday&&(
                  <div style={{gridColumn:"1/-1"}}>
                    <span style={{color:"#888"}}>🎂 </span>
                    {new Date(sel.birthday+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long"})}
                    {getAge(sel.birthday)!==null&&<span style={{color:"#888",fontSize:11}}> ({getAge(sel.birthday)} anos)</span>}
                    {nextBirthdayDays(sel.birthday)!==null&&nextBirthdayDays(sel.birthday)<=30&&<span style={{color:"#e67e22",fontSize:11,fontWeight:600}}> — em {nextBirthdayDays(sel.birthday)} dias</span>}
                  </div>
                )}
                {sel.stage==="Avaliação agendada"&&sel.avalDate&&(
                  <div style={{gridColumn:"1/-1"}}>
                    <span style={{color:"#888"}}>📅 Avaliação: </span>
                    <span style={{fontWeight:600,color:"#2a6b8a"}}>{fmtDate(sel.avalDate)}{sel.avalTime?" às "+sel.avalTime:""}</span>
                  </div>
                )}
                {nextAssessmentDate(sel)&&(
                  <div style={{gridColumn:"1/-1"}}>
                    <span style={{color:"#888"}}>📋 Próxima avaliação: </span>
                    <span style={{fontWeight:600,color:daysUntil(nextAssessmentDate(sel))<=7?"#c0392b":"#2a6b8a"}}>
                      {fmtDate(nextAssessmentDate(sel))}
                      {daysUntil(nextAssessmentDate(sel))<=14&&<span style={{fontWeight:600}}> ({daysUntil(nextAssessmentDate(sel))} dias)</span>}
                    </span>
                  </div>
                )}
              </div>
              {sel.notes&&(
                <div style={{background:"#f8f3ea",borderRadius:8,padding:"10px 12px",fontSize:13,color:"#555",marginBottom:12}}>
                  {sel.notes}
                </div>
              )}
              {(()=>{const s=lessonStats(sel);if(!s.total)return null;return(
                <div style={{background:"#f0f9f0",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:12,display:"flex",gap:16,flexWrap:"wrap",border:"1px solid #c0e4c0"}}>
                  <span style={{fontWeight:700,color:navy}}>Aulas este mês:</span>
                  <span style={{color:"#2d7a4f",fontWeight:600}}>✅ {s.done} realizadas</span>
                  {s.rescheduled>0&&<span style={{color:"#b05e1a",fontWeight:600}}>🔄 {s.rescheduled} reagendadas</span>}
                  {(s.canceledClient+s.canceledPro)>0&&<span style={{color:"#c0392b",fontWeight:600}}>❌ {s.canceledClient+s.canceledPro} canceladas</span>}
                </div>
              );})()}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{setForm({...sel,anamnese:sel.anamnese||{...EMPTY_ANAMNESE}});setModal("form");}}
                  style={{flex:1,background:navy,color:gold,border:"none",borderRadius:8,padding:"9px 0",fontWeight:700,cursor:"pointer"}}>
                  Editar cliente
                </button>
              </div>
            </div>
          )}

          {/* TAB ANAMNESE */}
          {detailTab==="anamnese"&&(
            <div>
              {[
                ["🎯 Objetivos",sel.anamnese?.objectives],
                ["🤕 Lesões e dores",sel.anamnese?.injuries],
                ["💊 Medicamentos",sel.anamnese?.medications],
                ["⚠️ Restrições",sel.anamnese?.restrictions],
                ["🏃 Histórico de atividade",sel.anamnese?.history],
                ["📝 Observações do profissional",sel.anamnese?.observations],
              ].map(([label,val])=>(
                <div key={label} style={{marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",marginBottom:4}}>{label}</div>
                  <div style={{background:val?"#f8f3ea":"#f5f0e8",borderRadius:8,padding:"10px 12px",fontSize:13,color:val?"#2a2218":"#bbb",minHeight:36,fontStyle:val?"normal":"italic"}}>
                    {val||"Não informado"}
                  </div>
                </div>
              ))}
              <button onClick={()=>{setForm({...sel,anamnese:sel.anamnese||{...EMPTY_ANAMNESE}});setModal("form");}}
                style={{width:"100%",background:navy,color:gold,border:"none",borderRadius:8,padding:"9px 0",fontWeight:700,cursor:"pointer",marginTop:4}}>
                Editar anamnese
              </button>
            </div>
          )}

          {/* TAB AVALIAÇÕES */}
          {detailTab==="avaliacoes"&&(
            <div>
              <SectionTitle action={
                <button onClick={()=>{setAssessForm({date:today(),professional:"",type:"Reavaliação",notes:"",nextDate:""});setSubModal("assessment");}}
                  style={{background:gold,color:navy,border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  + Registrar avaliação
                </button>
              }>Histórico de avaliações</SectionTitle>
              {nextAssessmentDate(sel)&&(
                <div style={{background:"#eef6fb",borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:12,color:"#2a6b8a",fontWeight:600,border:"1px solid #c0dff0"}}>
                  📋 Próxima avaliação sugerida: {fmtDate(nextAssessmentDate(sel))}
                  {daysUntil(nextAssessmentDate(sel))<=14&&<span style={{color:"#c0392b"}}> — em {daysUntil(nextAssessmentDate(sel))} dias</span>}
                </div>
              )}
              {(sel.assessments||[]).length===0?(
                <div style={{fontSize:13,color:"#aaa",textAlign:"center",padding:"20px 0"}}>Nenhuma avaliação registrada.</div>
              ):[...(sel.assessments||[])].sort((a,b)=>a.date>b.date?-1:1).map(a=>(
                <div key={a.id} style={{background:"#f8f3ea",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:8,border:"1px solid #e8dfc8"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"center"}}>
                    <span style={{fontWeight:700,color:navy}}>{a.type}</span>
                    <span style={{color:"#888",fontSize:12}}>{fmtDate(a.date)}</span>
                  </div>
                  {a.professional&&<div style={{color:"#888",fontSize:12,marginBottom:2}}>👤 {a.professional}</div>}
                  {a.nextDate&&<div style={{color:"#2a6b8a",fontSize:12,marginBottom:2}}>📅 Próxima: {fmtDate(a.nextDate)}</div>}
                  {a.notes&&<div style={{color:"#555",marginTop:6,fontSize:13,borderTop:"1px solid #e0d8cc",paddingTop:6}}>{a.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {/* TAB AULAS */}
          {detailTab==="aulas"&&(
            <div>
              {(()=>{const s=lessonStats(sel);return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                  {[{l:"Realizadas",v:s.done,c:"#2d7a4f"},{l:"Reagendadas",v:s.rescheduled,c:"#b05e1a"},{l:"Cancel. cliente",v:s.canceledClient,c:"#c0392b"},{l:"Cancel. prof.",v:s.canceledPro,c:"#888"}].map(x=>(
                    <div key={x.l} style={{background:x.c+"12",borderRadius:8,padding:"8px 10px",textAlign:"center",border:"1px solid "+x.c+"30"}}>
                      <div style={{fontSize:22,fontWeight:700,color:x.c}}>{x.v}</div>
                      <div style={{fontSize:10,color:"#888",marginTop:2}}>{x.l}</div>
                    </div>
                  ))}
                </div>
              );})()}
              <SectionTitle action={
                <button onClick={()=>{setLessonForm({date:today(),service:(sel.services||[])[0]||SERVICES[0],professional:"",status:"Realizada",notes:""});setSubModal("lesson");}}
                  style={{background:gold,color:navy,border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  + Registrar aula
                </button>
              }>Histórico de aulas</SectionTitle>
              {(sel.lessons||[]).length===0?(
                <div style={{fontSize:13,color:"#aaa",textAlign:"center",padding:"20px 0"}}>Nenhuma aula registrada.</div>
              ):[...(sel.lessons||[])].sort((a,b)=>a.date>b.date?-1:1).map(l=>{
                const sc=LESSON_STATUS_COLORS[l.status]||"#888";
                return(
                  <div key={l.id} style={{background:"#fff",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:7,border:"1px solid #e8dfc8"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:l.notes?6:0}}>
                      <div>
                        <span style={{fontWeight:600,color:navy}}>{l.service}</span>
                        {l.professional&&<span style={{color:"#888",fontSize:12}}> · {l.professional}</span>}
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{background:sc+"15",color:sc,border:"1px solid "+sc+"30",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:600}}>{l.status}</span>
                        <span style={{color:"#aaa",fontSize:12}}>{fmtDateShort(l.date)}</span>
                      </div>
                    </div>
                    {l.notes&&<div style={{color:"#555",fontSize:12,background:"#f8f3ea",borderRadius:6,padding:"6px 8px",borderLeft:"3px solid "+sc}}>{l.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB TOUCHPOINTS */}
          {detailTab==="touchpoints"&&(
            <div>
              <SectionTitle action={
                <button onClick={()=>{setTouchForm({date:today(),channel:"WhatsApp",direction:"Saída",summary:""});setSubModal("touch");}}
                  style={{background:gold,color:navy,border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  + Registrar contato
                </button>
              }>Touch points</SectionTitle>
              {(sel.touchpoints||[]).length===0?(
                <div style={{fontSize:13,color:"#aaa",textAlign:"center",padding:"20px 0"}}>Nenhum contato registrado.</div>
              ):[...(sel.touchpoints||[])].sort((a,b)=>a.date>b.date?-1:1).map(tp=>(
                <div key={tp.id} style={{display:"flex",gap:10,padding:"9px 12px",background:"#fff",borderRadius:8,border:"1px solid #e8dfc8",marginBottom:6}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:tp.direction==="Saída"?navy+"15":gold+"25",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
                    {tp.channel==="WhatsApp"?"💬":tp.channel==="Ligação"?"📞":"🤝"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontWeight:600,fontSize:12,color:navy}}>{tp.channel} · {tp.direction}</span>
                      <span style={{fontSize:11,color:"#aaa"}}>{fmtDateShort(tp.date)}</span>
                    </div>
                    <div style={{fontSize:12,color:"#555"}}>{tp.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB TAREFAS */}
          {detailTab==="tarefas"&&(
            <div>
              <SectionTitle action={
                <button onClick={()=>{setTaskForm({title:"",dueDate:"",done:false});setSubModal("task");}}
                  style={{background:gold,color:navy,border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  + Nova tarefa
                </button>
              }>Tarefas</SectionTitle>
              {(sel.tasks||[]).filter(t=>!t.done).length===0&&(sel.tasks||[]).filter(t=>t.done).length===0&&(
                <div style={{fontSize:13,color:"#aaa",textAlign:"center",padding:"20px 0"}}>Nenhuma tarefa.</div>
              )}
              {(sel.tasks||[]).filter(t=>!t.done).map(t=>{
                const ov=t.dueDate&&new Date(t.dueDate+"T12:00:00")<new Date();
                return(
                  <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:ov?"#fff3ee":"#fff",borderRadius:8,border:"1px solid "+(ov?"#f0a070":"#e8dfc8"),marginBottom:6}}>
                    <button onClick={()=>updateSel(c=>({...c,tasks:(c.tasks||[]).map(x=>x.id===t.id?{...x,done:true}:x)}))}
                      style={{width:20,height:20,borderRadius:4,border:"2px solid #c9b89a",background:"transparent",cursor:"pointer",flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:navy}}>{t.title}</div>
                      {t.dueDate&&<div style={{fontSize:11,color:ov?"#b05e1a":"#888"}}>📅 {fmtDate(t.dueDate)}{ov?" · Atrasada":""}</div>}
                    </div>
                    <button onClick={()=>updateSel(c=>({...c,tasks:(c.tasks||[]).filter(x=>x.id!==t.id)}))}
                      style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
                  </div>
                );
              })}
              {(sel.tasks||[]).filter(t=>t.done).length>0&&(
                <>
                  <div style={{fontSize:11,color:"#aaa",margin:"10px 0 5px",fontWeight:600}}>CONCLUÍDAS</div>
                  {(sel.tasks||[]).filter(t=>t.done).map(t=>(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#f0f0f0",borderRadius:8,marginBottom:4}}>
                      <div style={{width:20,height:20,borderRadius:4,background:"#2d7a4f",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,flexShrink:0}}>✓</div>
                      <span style={{flex:1,fontSize:12,color:"#aaa",textDecoration:"line-through"}}>{t.title}</span>
                      <button onClick={()=>updateSel(c=>({...c,tasks:(c.tasks||[]).filter(x=>x.id!==t.id)}))}
                        style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:16}}>×</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── SUB-MODAL: Avaliação agendada ── */}
      {pendingStage&&(
        <Modal title="📅 Agendar avaliação" onClose={()=>setPendingStage(null)}>
          <p style={{fontSize:13,color:"#555",marginBottom:16}}>Informe a data e horário agendados para a avaliação.</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Data" value={avalDate} onChange={setAvalDate} type="date"/>
            <Inp label="Horário" value={avalTime} onChange={setAvalTime} type="time"/>
          </div>
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={confirmAval} style={{flex:1,background:navy,color:gold,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,cursor:"pointer"}}>Confirmar</button>
            <button onClick={()=>setPendingStage(null)} style={{background:"#f0ebe0",color:"#555",border:"none",borderRadius:8,padding:"10px 16px",cursor:"pointer"}}>Cancelar</button>
          </div>
        </Modal>
      )}

      {/* ── SUB-MODAL: Avaliação ── */}
      {subModal==="assessment"&&(
        <Modal title="📋 Registrar avaliação" onClose={()=>setSubModal(null)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Data" value={assessForm.date} onChange={v=>setAssessForm(f=>({...f,date:v}))} type="date"/>
            <Sel label="Tipo" value={assessForm.type} onChange={v=>setAssessForm(f=>({...f,type:v}))} options={["Inicial","Reavaliação","Funcional","Postural","Específica"]}/>
          </div>
          <Inp label="Profissional responsável" value={assessForm.professional} onChange={v=>setAssessForm(f=>({...f,professional:v}))} placeholder="Nome do profissional"/>
          <Inp label="Data sugerida para próxima avaliação" value={assessForm.nextDate} onChange={v=>setAssessForm(f=>({...f,nextDate:v}))} type="date"/>
          <TA label="Resultados e observações" value={assessForm.notes} onChange={v=>setAssessForm(f=>({...f,notes:v}))} rows={5} placeholder="Resultados, medidas, progressos, observações…"/>
          <button onClick={async()=>{
            await updateSel(c=>({...c,assessments:[{...assessForm,id:Date.now().toString()},...(c.assessments||[])]}));
            setSubModal(null);
          }} style={{width:"100%",background:navy,color:gold,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,cursor:"pointer",marginTop:4}}>
            Salvar avaliação
          </button>
        </Modal>
      )}

      {/* ── SUB-MODAL: Aula ── */}
      {subModal==="lesson"&&(
        <Modal title="💪 Registrar aula" onClose={()=>setSubModal(null)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Data" value={lessonForm.date} onChange={v=>setLessonForm(f=>({...f,date:v}))} type="date"/>
            <Sel label="Serviço" value={lessonForm.service} onChange={v=>setLessonForm(f=>({...f,service:v}))} options={(sel.services||[]).length>0?sel.services:SERVICES}/>
          </div>
          <Inp label="Profissional" value={lessonForm.professional} onChange={v=>setLessonForm(f=>({...f,professional:v}))} placeholder="Nome do profissional"/>
          <Sel label="Status da aula" value={lessonForm.status} onChange={v=>setLessonForm(f=>({...f,status:v}))} options={LESSON_STATUS}/>
          <TA label="Comentários do profissional" value={lessonForm.notes} onChange={v=>setLessonForm(f=>({...f,notes:v}))} rows={4} placeholder="Como foi a aula, evolução observada, pontos de atenção, ajustes para próxima sessão…"/>
          <button onClick={async()=>{
            await updateSel(c=>({...c,lessons:[{...lessonForm,id:Date.now().toString()},...(c.lessons||[])]}));
            setSubModal(null);
          }} style={{width:"100%",background:navy,color:gold,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,cursor:"pointer",marginTop:4}}>
            Salvar aula
          </button>
        </Modal>
      )}

      {/* ── SUB-MODAL: Contato ── */}
      {subModal==="touch"&&(
        <Modal title="💬 Registrar contato" onClose={()=>setSubModal(null)}>
          <Inp label="Data" value={touchForm.date} onChange={v=>setTouchForm(f=>({...f,date:v}))} type="date"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Sel label="Canal" value={touchForm.channel} onChange={v=>setTouchForm(f=>({...f,channel:v}))} options={["WhatsApp","Presencial","Ligação","E-mail"]}/>
            <Sel label="Direção" value={touchForm.direction} onChange={v=>setTouchForm(f=>({...f,direction:v}))} options={["Saída","Entrada"]}/>
          </div>
          <TA label="Resumo do contato *" value={touchForm.summary} onChange={v=>setTouchForm(f=>({...f,summary:v}))} rows={3} placeholder="Do que se tratou o contato…"/>
          <button onClick={async()=>{
            if(!touchForm.summary) return;
            await updateSel(c=>({...c,touchpoints:[{...touchForm,id:Date.now().toString()},...(c.touchpoints||[])]}));
            setSubModal(null);
          }} disabled={!touchForm.summary} style={{width:"100%",background:navy,color:gold,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,cursor:"pointer",marginTop:4,opacity:touchForm.summary?1:.5}}>
            Salvar contato
          </button>
        </Modal>
      )}

      {/* ── SUB-MODAL: Tarefa ── */}
      {subModal==="task"&&(
        <Modal title="✅ Nova tarefa" onClose={()=>setSubModal(null)}>
          <Inp label="Descrição *" value={taskForm.title} onChange={v=>setTaskForm(f=>({...f,title:v}))} placeholder="Ex: Enviar protocolo de treino"/>
          <Inp label="Data limite" value={taskForm.dueDate} onChange={v=>setTaskForm(f=>({...f,dueDate:v}))} type="date"/>
          <button onClick={async()=>{
            if(!taskForm.title) return;
            await updateSel(c=>({...c,tasks:[{...taskForm,id:Date.now().toString(),done:false},...(c.tasks||[])]}));
            setSubModal(null);
          }} disabled={!taskForm.title} style={{width:"100%",background:navy,color:gold,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,cursor:"pointer",marginTop:4,opacity:taskForm.title?1:.5}}>
            Salvar tarefa
          </button>
        </Modal>
      )}
    </div>
  );
}
