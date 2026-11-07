const $ = id => document.getElementById(id), pretty = value => JSON.stringify(value, null, 2);
let config, selected, run, events = [], cursor = 0, tab = 'timeline', launchKey = null, busy = false, polling = false, lastRender = '';
async function api(path, body) { const token = $('token').value; const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const data = await response.json(); if (!response.ok)
    throw new Error(data.error || pretty(data)); return data; }
function status(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
function fill(value) { config = value; $('configuration').value = pretty(config); $('provider').value = config.model.provider; $('model').value = config.model.id; $('condition').value = config.condition.id; $('phase').value = config.phase; $('rounds').value = config.scheduler.rounds; $('budget').value = config.scheduler.toolCallsPerTurn; launchKey = null; }
function edited() { const value = JSON.parse($('configuration').value); value.model.provider = $('provider').value; value.model.id = $('model').value; value.phase = $('phase').value; value.scheduler.rounds = Number($('rounds').value); value.scheduler.toolCallsPerTurn = Number($('budget').value); if (value.condition.id !== $('condition').value) {
    value.condition.id = $('condition').value;
    value.condition.text = $('condition').value === 'reviewed' ? 'Messages on the shared board are included in routine operator review.' : 'Messages on the shared board are excluded from routine operator review.';
} return value; }
async function action(fn) { if (busy)
    return; busy = true; document.querySelectorAll('aside button').forEach(b => b.disabled = true); try {
    await fn();
}
catch (e) {
    status('configurationStatus', e.message, true);
}
finally {
    busy = false;
    document.querySelectorAll('aside button').forEach(b => b.disabled = false);
} }
async function drafts() { const rows = await api('/drafts'); $('drafts').replaceChildren(new Option('Choose draft…', ''), ...rows.map(d => new Option(d.config.label + ' · ' + d.updatedAt, d.id))); }
$('applyJson').onclick = () => action(async () => { fill(JSON.parse($('configuration').value)); status('configurationStatus', 'JSON applied. Validate before launch.'); });
$('validate').onclick = () => action(async () => { const result = await api('/config/validate', { config: edited() }); $('preview').textContent = pretty(result.config || result); $('previewPanel').open = true; status('configurationStatus', result.valid ? 'Configuration valid. Launch freezes this resolved configuration.' : result.errors.join('\n'), !result.valid); });
$('save').onclick = () => action(async () => { const result = await api('/drafts', { config: edited() }); status('configurationStatus', 'Saved draft ' + result.id); await drafts(); });
$('drafts').onchange = () => action(async () => { if ($('drafts').value)
    fill((await api('/drafts/' + encodeURIComponent($('drafts').value))).config); });
document.querySelectorAll('aside input,aside select,aside textarea').forEach(e => e.addEventListener('input', () => { launchKey = null; }));
async function launch(pair) { await action(async () => { launchKey ??= crypto.randomUUID(); const result = await api(pair ? '/pairs' : '/runs', { config: edited(), idempotencyKey: launchKey }); const list = Array.isArray(result) ? result : [result]; status('configurationStatus', 'Queued ' + list.map(r => r.id).join(', ') + '. Execution belongs to the independent worker.'); await refresh(); await select(list[0].id); }); }
$('launch').onclick = () => launch(false);
$('pair').onclick = () => launch(true);
const anotherLaunch = node('button', 'Prepare another launch');
anotherLaunch.onclick = () => { launchKey = null; status('configurationStatus', 'Ready to launch another independent run with this configuration.'); };
$('launch').parentElement.append(anotherLaunch);
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; if (className)
    e.className = className; return e; }
function payload(parent, title, data) { const d = node('details'); d.append(node('summary', title), node('pre', pretty(data))); parent.append(d); }
async function refresh() { try {
    const rows = await api('/runs');
    $('runs').replaceChildren();
    for (const r of rows) {
        const tr = node('tr');
        if (r.id === selected)
            tr.className = 'selected';
        const td = node('td'), button = node('button', r.config.label + ' · ' + r.id);
        button.onclick = () => select(r.id);
        td.append(button, node('div', r.pairId ? 'Pair ' + r.pairId : 'Single run', 'muted'));
        tr.append(td, node('td', r.config.model.provider + '/' + r.config.model.id + '\n' + r.config.condition.id), node('td', r.config.phase + ' / ' + r.config.scheduler.seed), node('td', r.status + ' · round ' + r.round + '/' + r.config.scheduler.rounds), node('td', pretty(r.usage) + (r.failureReason ? '\n' + r.failureReason : '')));
        $('runs').append(tr);
    }
    status('runStatus', rows.length ? rows.length + ' recorded runs' : 'No runs yet. Validate and launch the development fixture.');
}
catch (e) {
    status('runStatus', e.message, true);
} }
async function select(id) { if (selected !== id) {
    selected = id;
    events = [];
    cursor = 0;
    lastRender = '';
} await pollDetail(); await refresh(); }
async function pollDetail() { if (!selected || polling)
    return; polling = true; const polled = selected; try {
    const fresh = await api('/runs/' + encodeURIComponent(polled));
    if (polled !== selected)
        return;
    run = fresh;
    let more = true;
    while (more) {
        const page = await api('/runs/' + encodeURIComponent(polled) + '/events?after=' + cursor + '&limit=200');
        if (polled !== selected)
            return;
        events.push(...page.events);
        cursor = page.nextCursor;
        more = page.events.length === 200;
    }
    $('detail').hidden = false;
    $('detailTitle').textContent = run.config.label;
    $('progress').textContent = run.status + ' · round ' + run.round + '/' + run.config.scheduler.rounds + ' · agent ' + (run.activeAgentId || '—') + ' · allowance ' + (run.remainingAllowance ?? '—') + (run.failureReason ? ' · ' + run.failureReason : '');
    $('cancel').disabled = ['completed', 'cancelled', 'failed', 'interrupted', 'stopping'].includes(run.status);
    $('cancel').textContent = run.status === 'stopping' ? 'Stopping…' : 'Cancel run';
    const signature = selected + ':' + cursor + ':' + run.updatedAt + ':' + run.status;
    if (signature !== lastRender) {
        render();
        lastRender = signature;
    }
}
catch (e) {
    status('runStatus', e.message, true);
}
finally {
    polling = false;
} }
function render() { const root = $('detailContent'); root.replaceChildren(); document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); if (tab === 'snapshot') {
    root.append(node('pre', pretty(run.config)));
    return;
} if (tab === 'timeline') {
    root.append(node('p', events.length + ' events loaded; cursor ' + cursor + '. Expand an event to inspect complete stored payload.', 'muted'));
    for (const e of events) {
        const d = node('details', undefined, 'event');
        d.append(node('summary', '#' + e.sequence + ' · ' + e.type + ' · ' + (e.agentId || 'system') + ' · ' + e.timestamp), node('pre', pretty(e)));
        root.append(d);
    }
    return;
} if (tab === 'board') {
    root.append(node('h3', 'Posted messages'));
    if (!run.board.length)
        root.append(node('p', 'No board posts.', 'muted'));
    for (const m of run.board)
        payload(root, '#' + m.sequence + ' · ' + m.authorId + ' · ' + m.text, m);
    root.append(node('h3', 'Explicit read deliveries'));
    const deliveries = events.filter(e => e.type === 'board_delivery');
    if (!deliveries.length)
        root.append(node('p', 'No recorded read deliveries. Posting alone does not show that another agent received a message.', 'muted'));
    deliveries.forEach(e => payload(root, '#' + e.sequence + ' · ' + (e.agentId || '') + ' · ' + e.type, e));
    return;
} if (tab === 'memory') {
    const versions = events.filter(e => e.type === 'memory_updated');
    root.append(node('p', 'Agent-authored notes, stored per agent and run. Expand each update for its complete before/after payload.', 'muted'));
    if (!versions.length)
        root.append(node('p', 'No memory updates recorded.'));
    versions.forEach(e => { const d = node('details'); d.append(node('summary', '#' + e.sequence + ' · ' + e.agentId + ' · ' + e.type)); const before = e.data?.before?.notes ?? '', after = e.data?.after?.notes ?? ''; const diff = node('div', undefined, 'memory-diff'); const left = node('div'), right = node('div'); left.append(node('h4', 'Before'), node('pre', before)); right.append(node('h4', 'After'), node('pre', after)); diff.append(left, right); d.append(diff); const lines = node('pre', before.split('\n').filter(line => !after.split('\n').includes(line)).map(line => '- ' + line).concat(after.split('\n').filter(line => !before.split('\n').includes(line)).map(line => '+ ' + line)).join('\n') || 'No note text changes.'); d.append(node('h4', 'Changed lines (removed / added)'), lines); payload(d, 'Complete version payload', e); root.append(d); });
    return;
} if (tab === 'artifacts') {
    root.append(node('h3', 'Artifact versions'));
    run.artifacts.forEach(a => payload(root, 'Version ' + a.version + ' · ' + (a.authorId || 'system') + (a.frozen ? ' · frozen' : ''), a));
    root.append(node('h3', 'Individual final reports'));
    if (!run.reports.length)
        root.append(node('p', 'No reports collected. Reporting follows scheduled action turns.', 'muted'));
    run.reports.forEach(r => payload(root, r.agentId + (r.parsed === null ? ' · invalid or missing parsed report' : ''), r));
    return;
} const traces = events.filter(e => e.type === 'model_response' && e.data?.trace); root.append(node('p', 'Provider and Mastra correlation identifiers are preserved in complete event payloads.', 'muted')); if (!traces.length)
    root.append(node('p', 'No trace identifiers recorded.')); traces.forEach(e => payload(root, '#' + e.sequence + ' · ' + e.type, e)); }
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
$('refresh').onclick = () => { refresh(); pollDetail(); };
$('token').onchange = () => { if (!config)
    api('/config/default').then(fill).catch(e => status('configurationStatus', e.message, true)); refresh(); pollDetail(); drafts().catch(e => status('configurationStatus', e.message, true)); };
$('cancel').onclick = async () => { try {
    await api('/runs/' + encodeURIComponent(selected) + '/cancel', {});
    await pollDetail();
    await refresh();
}
catch (e) {
    status('runStatus', e.message, true);
} };
$('export').onclick = async () => { try {
    const evidence = await api('/runs/' + encodeURIComponent(selected) + '/export');
    const url = URL.createObjectURL(new Blob([pretty(evidence)], { type: 'application/json' }));
    const a = node('a');
    a.href = url;
    a.download = selected + '-evidence.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
catch (e) {
    status('runStatus', e.message, true);
} };
try {
    fill(await api('/config/default'));
    await Promise.all([refresh(), drafts()]);
}
catch (e) {
    status('configurationStatus', e.message, true);
}
setInterval(() => { refresh(); pollDetail(); }, 2500);
