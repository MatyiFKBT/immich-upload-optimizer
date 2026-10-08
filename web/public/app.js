const state = {
  profiles: [],
  visibleAssets: [],
  selectedAssets: new Map(),
  search: null,
  nextCursor: null,
  batchId: localStorage.getItem('immichOptimizerBatchId'),
  batch: null,
  batchContentSignature: null,
  pollTimer: null,
};

const elements = {
  status: document.querySelector('#connection-status'),
  searchForm: document.querySelector('#search-form'),
  from: document.querySelector('#date-from'),
  to: document.querySelector('#date-to'),
  album: document.querySelector('#album-select'),
  searchMessage: document.querySelector('#search-message'),
  resultsToolbar: document.querySelector('#results-toolbar'),
  resultsCount: document.querySelector('#results-count'),
  grid: document.querySelector('#asset-grid'),
  selectPage: document.querySelector('#select-page'),
  loadMore: document.querySelector('#load-more'),
  profileList: document.querySelector('#profile-list'),
  deleteOriginals: document.querySelector('#delete-originals'),
  startBatch: document.querySelector('#start-batch'),
  runMessage: document.querySelector('#run-message'),
  batchPanel: document.querySelector('#batch-panel'),
  batchStatus: document.querySelector('#batch-status'),
  batchSummary: document.querySelector('#batch-summary'),
  batchContent: document.querySelector('#batch-content'),
  batchMessage: document.querySelector('#batch-message'),
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let payload = {};
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

function showMessage(element, text, type = '') {
  element.textContent = text;
  element.className = `message${type ? ` ${type}` : ''}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${value} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let size = value / 1000;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function setStatus(text, healthy = true) {
  elements.status.textContent = text;
  elements.status.style.color = healthy ? 'var(--green)' : 'var(--red)';
  elements.status.style.borderColor = healthy ? '#a6dfca' : '#f1b6b2';
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function updateStartButton() {
  const selectedProfiles = elements.profileList.querySelectorAll('input:checked').length;
  const selectedAssets = state.selectedAssets.size;
  elements.startBatch.disabled = selectedProfiles === 0 || selectedAssets === 0;
  elements.startBatch.textContent = selectedAssets > 0
    ? `Prepare ${selectedAssets} selected image${selectedAssets === 1 ? '' : 's'}`
    : 'Prepare selected images';
}

function updateSelectionCard(card, checkbox, asset) {
  if (checkbox.checked) state.selectedAssets.set(asset.id, asset);
  else state.selectedAssets.delete(asset.id);
  card.classList.toggle('selected', checkbox.checked);
  updateStartButton();
}

function renderProfiles() {
  elements.profileList.replaceChildren();
  for (const profile of state.profiles) {
    const label = document.createElement('label');
    label.className = 'profile-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = profile.id;
    checkbox.addEventListener('change', updateStartButton);
    const copy = document.createElement('span');
    copy.append(createTextElement('strong', '', profile.label));
    const sourceText = profile.sources.includes('jpeg') ? 'JPEG source' : 'HEIC / HEIF source';
    copy.append(createTextElement('small', '', `${sourceText} · ${profile.id}`));
    label.append(checkbox, copy);
    elements.profileList.append(label);
  }
}

function renderAsset(asset) {
  const card = document.createElement('article');
  card.className = 'asset-card';
  const imageWrap = document.createElement('div');
  imageWrap.className = 'asset-thumb-wrap';
  const image = document.createElement('img');
  image.className = 'asset-thumb';
  image.loading = 'lazy';
  image.alt = asset.originalFileName;
  image.src = `/api/assets/${encodeURIComponent(asset.id)}/thumbnail`;
  const checkLabel = document.createElement('label');
  checkLabel.className = 'asset-check';
  checkLabel.setAttribute('aria-label', `Select ${asset.originalFileName}`);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.assetId = asset.id;
  checkbox.checked = state.selectedAssets.has(asset.id);
  checkbox.addEventListener('change', () => updateSelectionCard(card, checkbox, asset));
  checkLabel.append(checkbox);
  imageWrap.append(image, checkLabel);

  const details = document.createElement('div');
  details.className = 'asset-card-body';
  details.append(createTextElement('p', 'asset-name', asset.originalFileName));
  const taken = asset.fileCreatedAt ? new Date(asset.fileCreatedAt).toLocaleDateString() : 'Date unavailable';
  details.append(createTextElement('p', 'asset-meta', `${taken} · ${formatBytes(asset.size)}`));
  const sourceProfiles = asset.profiles.map((profile) => profile.label).join(', ');
  details.append(createTextElement('p', 'asset-meta', sourceProfiles));
  card.append(imageWrap, details);
  card.classList.toggle('selected', checkbox.checked);
  return card;
}

function renderSearchResult(result, append = false) {
  if (!append) {
    state.visibleAssets = [];
    elements.grid.replaceChildren();
  }
  state.visibleAssets.push(...result.items);
  for (const asset of result.items) elements.grid.append(renderAsset(asset));
  state.nextCursor = result.nextCursor;
  elements.resultsToolbar.classList.toggle('hidden', state.visibleAssets.length === 0);
  elements.resultsCount.textContent = `${state.visibleAssets.length} supported shown · ${result.total} Immich image matches`;
  elements.loadMore.classList.toggle('hidden', !state.nextCursor);
  elements.selectPage.checked = state.visibleAssets.length > 0 && state.visibleAssets.every((asset) => state.selectedAssets.has(asset.id));
  updateStartButton();
}

async function searchAssets(cursor) {
  const filters = state.search;
  if (!filters) return;
  showMessage(elements.searchMessage, 'Searching Immich…');
  elements.loadMore.disabled = true;
  try {
    const result = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify({ ...filters, ...(cursor ? { cursor } : {}) }),
    });
    renderSearchResult(result, Boolean(cursor));
    showMessage(elements.searchMessage, result.items.length === 0 ? 'No supported JPEG, HEIC, or HEIF images on this page.' : '');
  } catch (error) {
    showMessage(elements.searchMessage, error.message, 'error');
  } finally {
    elements.loadMore.disabled = false;
  }
}

function selectedProfileIds() {
  return [...elements.profileList.querySelectorAll('input:checked')].map((input) => input.value);
}

async function startBatch() {
  const assetIds = [...state.selectedAssets.keys()];
  const profileIds = selectedProfileIds();
  if (assetIds.length === 0 || profileIds.length === 0) return;
  elements.startBatch.disabled = true;
  showMessage(elements.runMessage, 'Creating optimization run…');
  try {
    const created = await api('/api/batches', {
      method: 'POST',
      body: JSON.stringify({
        assetIds,
        profileIds,
        deleteOriginal: elements.deleteOriginals.checked,
      }),
    });
    state.batchId = created.id;
    localStorage.setItem('immichOptimizerBatchId', created.id);
    elements.batchPanel.classList.remove('hidden');
    showMessage(elements.runMessage, 'Run created. Original assets remain safe until each replacement is verified.', 'success');
    await refreshBatch();
    elements.batchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showMessage(elements.runMessage, error.message, 'error');
  } finally {
    updateStartButton();
  }
}

function batchStatusLabel(batch) {
  const labels = {
    preparing: 'Preparing candidates',
    'awaiting-choice': 'Choose replacements',
    review: 'Review batch results',
    applying: 'Applying selected replacements',
    complete: 'Complete',
    failed: 'Stopped',
    expired: 'Expired',
  };
  return labels[batch.status] ?? batch.status;
}

function renderCandidateTable(batch) {
  const wrap = document.createElement('div');
  wrap.className = 'batch-table-wrap';
  const table = document.createElement('table');
  table.className = 'batch-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const title of ['Apply', 'Image', 'Original', 'Candidate', 'Savings', 'Result']) {
    const cell = document.createElement('th');
    cell.textContent = title;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const item of batch.items) {
    const row = document.createElement('tr');
    const candidate = item.candidates[0];
    const checkCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.assetId = item.assetId;
    checkbox.checked = item.status === 'ready' && candidate?.eligible === true;
    checkbox.disabled = item.status !== 'ready' || candidate?.eligible !== true;
    checkCell.append(checkbox);
    const name = document.createElement('td');
    name.className = 'batch-item-name';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'batch-thumb';
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.src = `/api/assets/${encodeURIComponent(item.assetId)}/thumbnail`;
    const filename = document.createElement('span');
    filename.textContent = item.originalFileName;
    name.append(thumbnail, filename);
    const original = document.createElement('td');
    original.className = 'size-value';
    original.textContent = formatBytes(item.sourceSize);
    const output = document.createElement('td');
    output.className = 'size-value';
    output.textContent = candidate?.size === null || candidate?.size === undefined ? '—' : formatBytes(candidate.size);
    const savings = document.createElement('td');
    if (candidate?.eligible && Number.isFinite(item.sourceSize)) {
      const saved = item.sourceSize - candidate.size;
      savings.className = 'saving size-value';
      savings.textContent = `${formatBytes(saved)} (${Math.round((saved / item.sourceSize) * 100)}%)`;
    } else {
      savings.className = 'not-smaller';
      savings.textContent = '—';
    }
    const result = document.createElement('td');
    const resultText = item.message ?? (item.status === 'ready' ? 'Ready' : item.status);
    result.textContent = item.replacementId ? `${resultText} · replacement ${item.replacementId}` : resultText;
    if (item.status === 'failed' || item.message?.includes('Not smaller')) result.className = 'failed-text';
    row.append(checkCell, name, original, output, savings, result);
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

const itemStatusText = {
  queued: 'Waiting to be processed…',
  processing: 'Downloading and optimizing…',
  applying: 'Uploading replacement and verifying metadata…',
};

function renderCompareItem(item, index, total) {
  const card = document.createElement('div');
  card.className = 'compare-item';
  const header = document.createElement('div');
  header.className = 'compare-item-head';
  header.append(
    createTextElement('span', 'asset-name', item.originalFileName),
    createTextElement('span', 'hint', `Image ${index + 1} of ${total} · original ${formatBytes(item.sourceSize)}`),
  );
  card.append(header);

  if (item.status === 'awaiting-choice') {
    const comparison = document.createElement('div');
    comparison.className = 'current-comparison';
    const image = document.createElement('img');
    image.alt = item.originalFileName;
    image.loading = 'lazy';
    image.src = `/api/assets/${encodeURIComponent(item.assetId)}/thumbnail`;
    const candidates = document.createElement('div');
    candidates.className = 'candidate-list';
    const eligibleSizes = item.candidates.filter((candidate) => candidate.eligible && candidate.size !== null).map((candidate) => candidate.size);
    const bestSize = eligibleSizes.length > 1 ? Math.min(...eligibleSizes) : null;
    for (const candidate of item.candidates) {
      const row = document.createElement('div');
      row.className = candidate.size !== null && candidate.size === bestSize ? 'candidate-row best' : 'candidate-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = candidate.label;
      if (candidate.size !== null && candidate.size === bestSize) {
        const badge = createTextElement('span', 'best-badge', 'Smallest');
        title.append(badge);
      }
      details.append(title);
      const sizeText = candidate.size === null
        ? candidate.error
        : `${formatBytes(candidate.size)} · ${candidate.eligible ? `${formatBytes(item.sourceSize - candidate.size)} smaller` : 'not smaller than original'}`;
      details.append(createTextElement('small', '', sizeText));
      const button = document.createElement('button');
      button.className = candidate.size !== null && candidate.size === bestSize ? 'button primary' : 'button secondary';
      button.type = 'button';
      button.textContent = candidate.eligible ? (candidate.size === bestSize ? 'Replace with smallest' : 'Replace with this') : 'Not eligible';
      button.disabled = !candidate.eligible;
      button.addEventListener('click', () => chooseCandidate(item.assetId, candidate.profileId));
      row.append(details, button);
      candidates.append(row);
    }
    comparison.append(image, candidates);
    const actions = document.createElement('div');
    actions.className = 'decision-actions';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'button secondary';
    skip.textContent = 'Keep original';
    skip.addEventListener('click', () => chooseCandidate(item.assetId, null));
    actions.append(skip);
    card.append(comparison, actions);
    return card;
  }

  const outcome = item.message ?? itemStatusText[item.status] ?? item.status;
  const text = item.replacementId ? `${outcome} · replacement ${item.replacementId}` : outcome;
  card.append(createTextElement('p', item.status === 'failed' ? 'failed-text' : 'hint', text));
  return card;
}

function renderCompare(batch) {
  const section = document.createElement('div');
  const awaiting = batch.awaiting ?? batch.items.filter((item) => item.status === 'awaiting-choice').length;
  section.append(createTextElement('p', 'hint', awaiting
    ? `Every selected image is already optimized. ${awaiting} still need a decision.`
    : 'All images have been decided.'));
  batch.items.forEach((item, index) => section.append(renderCompareItem(item, index, batch.total)));
  return section;
}

function renderBatch(batch) {
  state.batch = batch;
  elements.batchPanel.classList.remove('hidden');
  elements.batchStatus.textContent = batchStatusLabel(batch);
  const progress = batch.mode === 'compare'
    ? `${batch.resolved} of ${batch.total} images decided`
    : `${Math.min(batch.currentIndex + (batch.currentIndex < batch.total ? 1 : 0), batch.total)} of ${batch.total} images`;
  elements.batchSummary.textContent = `${progress} · originals ${batch.deleteOriginal ? 'will be deleted only after verification' : 'will be kept'}`;
  showMessage(elements.batchMessage, batch.error ?? '');
  const signature = JSON.stringify([
    batch.id,
    batch.mode,
    batch.status,
    batch.deleteOriginal,
    batch.error,
    batch.items.map((item) => [item.assetId, item.status, item.message, item.sourceSize, item.replacementId, item.originalDeleted, item.candidates.map((candidate) => [candidate.profileId, candidate.size, candidate.eligible, candidate.error])]),
  ]);

  if (signature !== state.batchContentSignature) {
    state.batchContentSignature = signature;
    const previousChecks = new Map(
      [...elements.batchContent.querySelectorAll('input[type="checkbox"][data-asset-id]')].map((checkbox) => [checkbox.dataset.assetId, checkbox.checked]),
    );
    elements.batchContent.replaceChildren();

    if (batch.status === 'preparing' || batch.status === 'applying') {
      elements.batchContent.append(createTextElement('p', 'hint', batch.status === 'preparing' ? 'Downloading and optimizing every selected image. Decisions unlock as soon as the run finishes.' : 'Uploading replacements and verifying their Immich metadata…'));
      elements.batchContent.append(renderCandidateTable(batch));
    } else if (batch.mode === 'compare' && batch.status === 'awaiting-choice') {
      elements.batchContent.append(renderCompare(batch));
    } else if (batch.mode === 'batch' && batch.status === 'review') {
      elements.batchContent.append(createTextElement('p', 'hint', 'Candidates are ready. Uncheck any image you want to leave unchanged, then explicitly apply the selected replacements.'));
      elements.batchContent.append(renderCandidateTable(batch));
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'button primary';
      apply.textContent = 'Apply selected replacements';
      apply.addEventListener('click', applySelectedBatch);
      elements.batchContent.append(apply);
    } else {
      elements.batchContent.append(renderCandidateTable(batch));
    }

    for (const checkbox of elements.batchContent.querySelectorAll('input[type="checkbox"][data-asset-id]')) {
      const previous = previousChecks.get(checkbox.dataset.assetId);
      if (previous !== undefined) checkbox.checked = previous;
    }
  }

  clearTimeout(state.pollTimer);
  if (batch.status === 'preparing' || batch.status === 'applying' || batch.busy) {
    state.pollTimer = setTimeout(() => void refreshBatch(), 1100);
  } else {
    state.pollTimer = null;
  }
}

async function refreshBatch() {
  if (!state.batchId) return;
  try {
    const batch = await api(`/api/batches/${encodeURIComponent(state.batchId)}`);
    renderBatch(batch);
  } catch (error) {
    showMessage(elements.batchMessage, error.message, 'error');
  }
}

async function chooseCandidate(assetId, profileId) {
  try {
    await api(`/api/batches/${encodeURIComponent(state.batchId)}/assets/${encodeURIComponent(assetId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
    await refreshBatch();
  } catch (error) {
    showMessage(elements.batchMessage, error.message, 'error');
  }
}

async function applySelectedBatch() {
  const selected = [...elements.batchContent.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => checkbox.dataset.assetId)
    .filter(Boolean);
  if (!window.confirm(`Apply ${selected.length} verified-smaller candidate(s)?`)) return;
  try {
    await api(`/api/batches/${encodeURIComponent(state.batchId)}/apply`, {
      method: 'POST',
      body: JSON.stringify({ assetIds: selected }),
    });
    await refreshBatch();
  } catch (error) {
    showMessage(elements.batchMessage, error.message, 'error');
  }
}

async function loadInitialData() {
  try {
    const [albums, profileResponse] = await Promise.all([
      api('/api/albums'),
      api('/api/profiles'),
    ]);
    for (const album of albums.albums) {
      const option = document.createElement('option');
      option.value = album.id;
      option.textContent = album.albumName;
      elements.album.append(option);
    }
    state.profiles = profileResponse.profiles;
    renderProfiles();
    setStatus('Connected to Immich');
  } catch (error) {
    setStatus('Connection failed', false);
    showMessage(elements.searchMessage, error.message, 'error');
  }
  if (state.batchId) {
    elements.batchPanel.classList.remove('hidden');
    await refreshBatch();
  }
}

elements.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const albumId = elements.album.value;
  const from = elements.from.value;
  const to = elements.to.value;
  if (!albumId && !from && !to) {
    showMessage(elements.searchMessage, 'Choose an album, a start date, or an end date.', 'error');
    return;
  }
  state.search = { ...(albumId ? { albumId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  state.selectedAssets.clear();
  elements.resultsToolbar.classList.add('hidden');
  await searchAssets(null);
});

elements.loadMore.addEventListener('click', () => {
  if (state.nextCursor) void searchAssets(state.nextCursor);
});

elements.selectPage.addEventListener('change', () => {
  for (const asset of state.visibleAssets) {
    const checkbox = elements.grid.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`);
    if (!checkbox) continue;
    checkbox.checked = elements.selectPage.checked;
    checkbox.closest('.asset-card').classList.toggle('selected', checkbox.checked);
    if (checkbox.checked) state.selectedAssets.set(asset.id, asset);
    else state.selectedAssets.delete(asset.id);
  }
  updateStartButton();
});

elements.startBatch.addEventListener('click', startBatch);
void loadInitialData();
