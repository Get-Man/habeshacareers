const AdminApp = {
  key() { return sessionStorage.getItem('habesha_admin_key') || ''; },
  saveKey() {
    const v = document.getElementById('adminKey').value.trim();
    if (v) sessionStorage.setItem('habesha_admin_key', v);
    this.msg('Admin key saved for this tab.');
    this.refreshAll();
  },
  msg(t, err=false){ const el=document.getElementById('adminMsg'); if(el){ el.textContent=t; el.style.color=err?'#b91c1c':'#555'; } },
  async api(path, opts={}) {
    const key = this.key();
    const res = await fetch(path, { ...opts, headers: { 'Accept':'application/json','Content-Type':'application/json','x-admin-key': key, ...(opts.headers||{}) } });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.message || data.error || ('HTTP '+res.status));
    return data;
  },
  esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  pill(s){ const cls = /connect|active|ok|approv/i.test(s)?'status-connected':/pend|run/i.test(s)?'status-pending':/error|reject|block|fail/i.test(s)?'status-error':''; return `<span class="pill ${cls}">${this.esc(s||'')}</span>`; },
  async refreshAll(){ await Promise.allSettled([this.loadStats(),this.loadSources(),this.loadRuns(),this.loadSubs(),this.loadJobs()]); },
  async loadStats(){
    try {
      const { stats } = await this.api('/api/admin/stats');
      const t = stats.totals || {};
      document.getElementById('statsCards').innerHTML = [
        ['Total',t.total],['Active',t.active],['Expired',t.expired],['New Today',stats.newToday],['New Week',stats.newThisWeek],
        ['Sources',stats.sources?.total],['Connected',stats.sources?.connected],['Failed',stats.sources?.failed],['Organizations',t.organizations]
      ].map(([h,n])=>`<div class="admin-card"><h4>${h}</h4><div class="n">${n??0}</div></div>`).join('');
    } catch(e){ this.msg('Stats: '+e.message,true); }
  },
  async loadSources(){
    try {
      const { sources } = await this.api('/api/admin/sources');
      document.querySelector('#sourcesTable tbody').innerHTML = sources.map(s=>`<tr>
        <td><strong>${this.esc(s.name)}</strong><br><small>${this.esc(s.slug)}</small><br><small>${this.esc(s.listing_url||'')}</small></td>
        <td>${this.esc(s.source_type)}</td><td>${this.pill(s.integration_status)}<br><small>${this.esc(s.status_note||s.last_error||'')}</small></td>
        <td>${s.enabled?'Yes':'No'}</td><td>${this.esc((s.last_sync_at||'').slice(0,19).replace('T',' '))}</td>
        <td class="admin-actions"><button class="btn-secondary" onclick="AdminApp.toggleSource('${this.esc(s.slug)}',${!s.enabled})">${s.enabled?'Disable':'Enable'}</button> <button class="btn-primary" onclick="AdminApp.syncSource('${this.esc(s.slug)}')">Sync</button></td>
      </tr>`).join('');
    } catch(e){ this.msg('Sources: '+e.message,true); }
  },
  async toggleSource(slug, enabled){ try{ await this.api('/api/admin/sources',{method:'POST',body:JSON.stringify({action:'setEnabled',slug,enabled})}); this.loadSources(); }catch(e){ alert(e.message);} },
  async syncSource(slug){ this.msg('Syncing '+slug+'...'); try{ const r=await this.api('/api/admin/sync',{method:'POST',body:JSON.stringify({slug})}); this.msg('Sync result: '+JSON.stringify(r.result)); this.refreshAll(); }catch(e){ this.msg(e.message,true); } },
  async syncAll(){ this.msg('Syncing enabled sources...'); try{ const r=await this.api('/api/admin/sync',{method:'POST',body:'{}'}); this.msg('Sync result: '+JSON.stringify(r.result)); this.refreshAll(); }catch(e){ this.msg(e.message,true); } },
  async loadRuns(){
    try { const { runs } = await this.api('/api/admin/runs');
      document.querySelector('#runsTable tbody').innerHTML = runs.map(r=>`<tr><td>${this.esc((r.started_at||'').slice(0,19).replace('T',' '))}</td><td>${this.esc(r.source_name||r.source_slug||'all')}</td><td>${this.esc(r.trigger_type)}</td><td>${this.pill(r.status)}</td><td>f:${r.fetched_count} n:${r.new_count} u:${r.updated_count} d:${r.duplicate_count} e:${r.error_count} x:${r.expired_count}</td><td>${this.esc(r.message||'')}</td></tr>`).join('');
    } catch(e){}
  },
  async loadSubs(){
    try { const { submissions } = await this.api('/api/admin/submissions');
      document.querySelector('#subsTable tbody').innerHTML = submissions.map(s=>{ const p=s.payload||{}; return `<tr><td>${s.id}</td><td>${this.esc(p.company||s.organization_name)}</td><td>${this.esc(p.title)}</td><td>${this.pill(s.approval_status)}</td><td>${this.esc((s.created_at||'').slice(0,10))}</td><td class="admin-actions">${s.approval_status==='pending'?`<button class="btn-primary" onclick="AdminApp.approveSub(${s.id})">Approve</button> <button class="btn-secondary" onclick="AdminApp.rejectSub(${s.id})">Reject</button>`:''}</td></tr>`; }).join('');
    } catch(e){}
  },
  async approveSub(id){ try{ await this.api('/api/admin/submissions',{method:'POST',body:JSON.stringify({action:'approve',id})}); this.refreshAll(); }catch(e){ alert(e.message);} },
  async rejectSub(id){ const note=prompt('Reviewer note (optional)')||''; try{ await this.api('/api/admin/submissions',{method:'POST',body:JSON.stringify({action:'reject',id,note})}); this.refreshAll(); }catch(e){ alert(e.message);} },
  async loadJobs(){
    try { const status=document.getElementById('jobStatusFilter').value; const { jobs } = await this.api('/api/admin/jobs'+(status?`?status=${encodeURIComponent(status)}`:''));
      document.querySelector('#jobsTable tbody').innerHTML = jobs.map(j=>`<tr><td>${j.id}</td><td>${this.esc(j.title)}</td><td>${this.esc(j.company)}</td><td>${this.esc(j.origin)}</td><td>${this.esc(j.source_name||'')}</td><td>${this.pill(j.status)}</td><td>${this.esc((j.deadline||'').slice(0,10))}</td><td class="admin-actions"><button class="btn-secondary" onclick="AdminApp.jobAction(${j.id},'${j.status==='active'?'archive':'activate'}')">${j.status==='active'?'Archive':'Activate'}</button> <button class="btn-secondary" onclick="AdminApp.jobAction(${j.id},'feature', ${!j.featured})">${j.featured?'Unfeature':'Feature'}</button></td></tr>`).join('');
    } catch(e){}
  },
  async jobAction(id, action, featured){ try{ await this.api('/api/admin/jobs',{method:'POST',body:JSON.stringify({id,action,featured})}); this.loadJobs(); }catch(e){ alert(e.message);} }
};
window.AdminApp = AdminApp;
document.addEventListener('DOMContentLoaded', ()=>{ document.getElementById('adminKey').value = AdminApp.key(); if (AdminApp.key()) AdminApp.refreshAll(); });
