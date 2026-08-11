import { createKitahePmAssetPackageImporter } from './asset-package-importer.js';

const PLUGIN_ID = 'pce-kitahe-pm-converter';
const CAPABILITY_NAME = 'kitahe-pm-script-converter';
const DEFAULT_PROTAGONIST_NAME = 'ハドソン';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function scriptValue(script) {
  if (typeof script === 'string') return script;
  return String(
    script?.relativePath
    || script?.path
    || script?.file
    || script?.name
    || script?.id
    || '',
  ).trim();
}

function scriptLabel(script) {
  if (typeof script === 'string') return script;
  return String(script?.label || script?.name || scriptValue(script) || 'SCR').trim();
}

function normalizeColorTokens(inspection) {
  return asArray(inspection?.colorTokens).map((entry, index) => {
    const token = typeof entry === 'string'
      ? entry
      : String(entry?.token || entry?.colorToken || entry?.color || entry?.id || '').trim();
    return {
      token: token || `COLOR_${index + 1}`,
      count: Math.max(0, asInteger(entry?.count ?? entry?.uses, 0)),
    };
  });
}

function requirementHint(requirement) {
  return [
    requirement?.kind,
    requirement?.type,
    requirement?.assetType,
    requirement?.format,
    requirement?.command,
    requirement?.source,
    requirement?.key,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function requirementKind(requirement) {
  const declaredTypes = asArray(requirement?.acceptableAssetTypes || requirement?.assetTypes)
    .map((type) => String(type || '').toLowerCase());
  const hint = requirementHint(requirement);
  if (declaredTypes.includes('adpcm') || /\bp04\b|adpcm|voice/.test(hint)) return 'adpcm';
  if (declaredTypes.includes('cdda-track') || /gd.?da|cd-?da|cdda/.test(hint)) return 'cdda';
  if (declaredTypes.some((type) => type === 'psg-song' || type === 'psg-sfx') || /midi|\bpsg\b/.test(hint)) return 'psg';
  return 'visual';
}

function normalizeAssetRequirements(inspection) {
  return asArray(inspection?.assetRequirements).map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : { key: String(entry || '') };
    const key = String(
      raw.key
      || raw.mappingKey
      || raw.assetKey
      || raw.source
      || raw.path
      || raw.name
      || `asset_${index + 1}`,
    ).trim();
    return {
      ...raw,
      key,
      label: String(raw.label || raw.source || raw.path || raw.name || key).trim(),
      kind: requirementKind(raw),
    };
  });
}

function diagnosticLevel(diagnostic) {
  const raw = String(diagnostic?.level || diagnostic?.severity || 'warning').toLowerCase();
  if (raw === 'error' || raw === 'fatal') return 'error';
  if (raw === 'info' || raw === 'note') return 'info';
  return 'warning';
}

function diagnosticCounts(diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  asArray(diagnostics).forEach((diagnostic) => {
    counts[diagnosticLevel(diagnostic)] += 1;
  });
  return counts;
}

function diagnosticLocation(diagnostic) {
  const source = String(
    diagnostic?.script
    || diagnostic?.file
    || diagnostic?.source
    || diagnostic?.path
    || '',
  ).trim();
  const line = asInteger(diagnostic?.lineNumber ?? diagnostic?.line, 0);
  if (source && line > 0) return `${source}:${line}`;
  if (source) return source;
  if (line > 0) return `line ${line}`;
  return '-';
}

function diagnosticMessage(diagnostic) {
  return String(diagnostic?.message || diagnostic?.reason || diagnostic?.code || '診断').trim();
}

function summaryRows(summary) {
  if (!summary || typeof summary !== 'object') return [];
  return Object.entries(summary)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 16);
}

function modePreviewEntries(modePreviews) {
  if (Array.isArray(modePreviews)) {
    return modePreviews.map((preview, index) => ({
      mode: String(preview?.mode || preview?.id || preview?.name || `mode_${index + 1}`),
      preview: preview && typeof preview === 'object' ? preview : { value: preview },
    }));
  }
  if (!modePreviews || typeof modePreviews !== 'object') return [];
  return Object.entries(modePreviews).map(([mode, preview]) => ({
    mode,
    preview: preview && typeof preview === 'object' ? preview : { value: preview },
  }));
}

function modePreviewsHtml(modePreviews) {
  const entries = modePreviewEntries(modePreviews);
  if (!entries.length) return '';
  return `
    <h4>Mode previews</h4>
    <div class="pce-kitahe-preview-modes">
      ${entries.map(({ mode, preview }) => {
        const details = preview.summary && typeof preview.summary === 'object'
          ? preview.summary
          : (preview.totals && typeof preview.totals === 'object' ? preview.totals : preview);
        const counts = diagnosticCounts(preview.diagnostics);
        const status = preview.ok === false || counts.error ? 'error' : (counts.warning ? 'warning' : 'ok');
        return `
          <article data-level="${status}">
            <header>
              <strong>${esc(mode === 'append' ? '追加' : (mode === 'replace' ? '置換' : mode))}</strong>
              <span>${preview.ok === false ? 'ERROR' : 'OK'}</span>
            </header>
            ${summaryRows(details).length ? `
              <dl>
                ${summaryRows(details).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}
              </dl>
            ` : '<p>変換可能です。</p>'}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function sceneBudgetEntries(sceneBudgets) {
  if (Array.isArray(sceneBudgets)) {
    return sceneBudgets.map((budget, index) => ({
      id: String(budget?.sceneId || budget?.id || budget?.name || `scene_${index + 1}`),
      budget: budget && typeof budget === 'object' ? budget : { bytes: budget },
    }));
  }
  if (!sceneBudgets || typeof sceneBudgets !== 'object') return [];
  return Object.entries(sceneBudgets).map(([id, budget]) => ({
    id,
    budget: budget && typeof budget === 'object' ? budget : { bytes: budget },
  }));
}

function sceneBudgetsHtml(sceneBudgets) {
  const entries = sceneBudgetEntries(sceneBudgets);
  if (!entries.length) return '';
  return `
    <h4>Scene budgets</h4>
    <div class="pce-kitahe-table-wrap">
      <table class="pce-kitahe-budget-table">
        <thead><tr><th>Scene</th><th>Pack bytes</th><th>Limit</th><th>Commands</th></tr></thead>
        <tbody>
          ${entries.map(({ id, budget }) => {
            const bytes = budget.bytes ?? budget.scenePackBytes ?? budget.packBytes ?? budget.estimatedBytes ?? '-';
            const limit = budget.limit ?? budget.limitBytes ?? budget.scenePackLimit ?? budget.packByteLimit ?? '-';
            const commands = budget.commands ?? budget.commandCount ?? '-';
            const over = Number.isFinite(Number(bytes)) && Number.isFinite(Number(limit)) && Number(bytes) > Number(limit);
            return `
              <tr data-level="${over || budget.ok === false ? 'error' : 'ok'}">
                <td><code>${esc(id)}</code></td>
                <td>${esc(bytes)}</td>
                <td>${esc(limit)}</td>
                <td>${esc(commands)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function defaultAssetMapping(requirement) {
  const suggestedAssetId = String(requirement?.suggestedAssetId || '');
  const display = requirement.kind === 'visual'
    ? (String(requirement?.suggestedAssetType || '').toLowerCase() === 'sprite'
      || String(requirement?.display || requirement?.role || '').toLowerCase() === 'sprite'
      ? 'sprite'
      : 'background')
    : undefined;
  return {
    action: suggestedAssetId ? 'map' : 'omit',
    assetId: suggestedAssetId,
    display,
    x: display === 'background' ? 2 : 128,
    y: display === 'background' ? 1 : 24,
    slot: 0,
    animationId: '',
  };
}

function initialAssetMapping(requirement, saved) {
  const automatic = defaultAssetMapping(requirement);
  if (!saved || typeof saved !== 'object') return automatic;
  const savedAssetId = String(saved.assetId || saved.id || '');
  const action = saved.action === 'omit' || saved.omit === true
    ? 'omit'
    : (saved.action === 'map' || savedAssetId ? 'map' : automatic.action);
  return {
    ...automatic,
    ...saved,
    action,
    assetId: savedAssetId || (action === automatic.action ? automatic.assetId : ''),
  };
}

function acceptedAssetTypes(requirement, mapping) {
  const declared = asArray(requirement?.acceptableAssetTypes || requirement?.assetTypes)
    .map((type) => String(type || '').trim())
    .filter(Boolean);
  if (declared.length) {
    if (requirement.kind !== 'visual') return declared;
    const visualType = mapping.display === 'sprite' ? 'sprite' : 'image';
    return declared.includes(visualType) ? [visualType] : declared;
  }
  if (requirement.kind === 'adpcm') return ['adpcm'];
  if (requirement.kind === 'cdda') return ['cdda-track'];
  if (requirement.kind === 'psg') return ['psg-song'];
  return mapping.display === 'sprite' ? ['sprite'] : ['image'];
}

function assetOptions(assets, requirement, mapping) {
  const accepted = new Set(acceptedAssetTypes(requirement, mapping));
  const rows = asArray(assets)
    .filter((asset) => accepted.has(String(asset?.type || '')))
    .sort((a, b) => String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'ja'));
  const current = String(mapping.assetId || '');
  const options = ['<option value="">アセットを選択</option>'];
  rows.forEach((asset) => {
    const id = String(asset?.id || '');
    options.push(
      `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>`
      + `${esc(asset?.name || id)} (${esc(asset?.type || '')} / ${esc(id)})</option>`,
    );
  });
  if (current && !rows.some((asset) => String(asset?.id || '') === current)) {
    options.push(`<option value="${esc(current)}" selected>⚠ ${esc(current)} (現在の一覧にありません)</option>`);
  }
  return options.join('');
}

function animationOptions(assets, assetId, current) {
  const asset = asArray(assets).find((entry) => String(entry?.id || '') === String(assetId || ''));
  const rows = asArray(asset?.options?.animations);
  const values = rows.map((row, index) => ({
    id: String(row?.id || row?.name || (index === 0 ? 'default' : `row_${index + 1}`)),
    label: String(row?.name || row?.id || (index === 0 ? 'default' : `row_${index + 1}`)),
  }));
  if (!values.length) values.push({ id: 'default', label: 'default' });
  const options = ['<option value="">変更しない</option>'];
  values.forEach((row) => {
    options.push(`<option value="${esc(row.id)}" ${row.id === current ? 'selected' : ''}>${esc(row.label)}</option>`);
  });
  if (current && !values.some((row) => row.id === current)) {
    options.push(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
  }
  return options.join('');
}

function scriptCheckboxRows(state) {
  if (!state.scripts.length) {
    return '<p class="pce-kitahe-empty">SCRIPT 配下に SCR が見つかりません。</p>';
  }
  return state.scripts.map((script, index) => {
    const value = scriptValue(script);
    const checked = state.selectedScripts.has(value);
    return `
      <label class="pce-kitahe-script-row">
        <input type="checkbox" data-script-index="${index}" ${checked ? 'checked' : ''} />
        <span>${esc(scriptLabel(script))}</span>
        ${typeof script === 'object' && script?.commandCount != null
          ? `<small>${asInteger(script.commandCount, 0)} commands</small>`
          : ''}
      </label>
    `;
  }).join('');
}

function entryOptions(state) {
  const candidates = asArray(state.inspection?.entryCandidates).length
    ? asArray(state.inspection.entryCandidates)
    : state.scripts.filter((script) => state.selectedScripts.has(scriptValue(script)));
  const available = candidates
    .map((entry) => ({ value: scriptValue(entry), label: scriptLabel(entry) }))
    .filter((entry) => entry.value && state.selectedScripts.has(entry.value));
  if (!available.length) {
    state.selectedScripts.forEach((value) => available.push({ value, label: value }));
  }
  if (!available.some((entry) => entry.value === state.entryScript)) {
    state.entryScript = available[0]?.value || '';
  }
  return available.map((entry) => (
    `<option value="${esc(entry.value)}" ${entry.value === state.entryScript ? 'selected' : ''}>${esc(entry.label)}</option>`
  )).join('');
}

function assetMappingRows(state) {
  const requirements = normalizeAssetRequirements(state.inspection);
  if (!requirements.length) return '<p class="pce-kitahe-empty">到達可能な画像・音声参照はありません。</p>';
  return requirements.map((requirement, index) => {
    const mapping = state.assetMappings[requirement.key] || defaultAssetMapping(requirement);
    const mapped = mapping.action === 'map';
    const visual = requirement.kind === 'visual';
    const sprite = visual && mapping.display === 'sprite';
    return `
      <article class="pce-kitahe-map-card ${mapped ? '' : 'is-omitted'}" data-map-card="${index}">
        <header>
          <div>
            <strong>${esc(requirement.label)}</strong>
            <small>${esc(requirement.kind.toUpperCase())} / <code>${esc(requirement.key)}</code></small>
          </div>
          <label class="pce-kitahe-map-toggle" title="チェックOFF: 明示的に省略">
            <input type="checkbox" data-map-enabled="${index}" aria-label="登録済みアセットへ対応。OFFで明示的に省略"
              ${mapped ? 'checked' : ''} />
          </label>
        </header>
        <div class="pce-kitahe-map-fields ${mapped ? '' : 'is-disabled'}">
          ${visual ? `
            <label class="form-group">
              <span class="form-label">表示種別</span>
              <select class="form-select" data-map-display="${index}" ${mapped ? '' : 'disabled'}>
                <option value="background" ${sprite ? '' : 'selected'}>BG</option>
                <option value="sprite" ${sprite ? 'selected' : ''}>Sprite</option>
              </select>
            </label>
          ` : ''}
          <label class="form-group pce-kitahe-map-asset">
            <span class="form-label">PCE asset</span>
            <select class="form-select" data-map-asset="${index}" ${mapped ? '' : 'disabled'}>
              ${assetOptions(state.assets, requirement, mapping)}
            </select>
          </label>
          ${visual && !sprite ? `
            <label class="form-group">
              <span class="form-label">Tile X</span>
              <input class="form-input" data-map-x="${index}" type="number" min="0" max="31"
                value="${asInteger(mapping.x, 2)}" ${mapped ? '' : 'disabled'} />
            </label>
            <label class="form-group">
              <span class="form-label">Tile Y</span>
              <input class="form-input" data-map-y="${index}" type="number" min="0" max="31"
                value="${asInteger(mapping.y, 1)}" ${mapped ? '' : 'disabled'} />
            </label>
          ` : ''}
          ${sprite ? `
            <label class="form-group">
              <span class="form-label">Sprite X / Y</span>
              <output class="pce-kitahe-auto-position">(ICG X + 元crop X) × BG幅 / 640 + BG表示X / Y 17</output>
            </label>
            <label class="form-group">
              <span class="form-label">Sprite slot</span>
              <select class="form-select" data-map-slot="${index}" ${mapped ? '' : 'disabled'}>
                ${[0, 1, 2, 3].map((slot) => `<option value="${slot}" ${asInteger(mapping.slot, 0) === slot ? 'selected' : ''}>${slot}</option>`).join('')}
              </select>
            </label>
            <label class="form-group">
              <span class="form-label">Animation</span>
              <select class="form-select" data-map-animation="${index}" ${mapped ? '' : 'disabled'}>
                ${animationOptions(state.assets, mapping.assetId, mapping.animationId)}
              </select>
            </label>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function diagnosticRows(diagnostics) {
  if (!asArray(diagnostics).length) {
    return '<p class="pce-kitahe-empty">診断はありません。</p>';
  }
  return `
    <div class="pce-kitahe-diagnostic-list">
      ${asArray(diagnostics).map((diagnostic) => {
        const level = diagnosticLevel(diagnostic);
        return `
          <div class="pce-kitahe-diagnostic" data-level="${level}">
            <span>${level === 'error' ? 'ERROR' : (level === 'warning' ? 'WARN' : 'INFO')}</span>
            <code>${esc(diagnosticLocation(diagnostic))}</code>
            <p>${esc(diagnosticMessage(diagnostic))}</p>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function sourceStepHtml(state) {
  return `
    <section class="pce-kitahe-step">
      <div class="pce-kitahe-section-head">
        <div><span>1</span><h3>Resource root と SCR を選択</h3></div>
        <button class="btn-sm" type="button" data-kitahe-action="pick-root"
          ${state.busy || state.targetMedia !== 'cd' ? 'disabled' : ''}>フォルダーを選択</button>
      </div>
      <div class="pce-kitahe-source-path" title="${esc(state.sourceRoot)}">
        ${state.sourceRoot ? esc(state.sourceRoot) : '北へ。PhotoMemories の resource root を選択してください。'}
      </div>
      ${state.sourceRoot ? `
        <div class="pce-kitahe-source-grid">
          <div>
            <div class="pce-kitahe-subhead">
              <strong>SCR</strong>
              <span>${state.selectedScripts.size} / ${state.scripts.length} 選択</span>
            </div>
            <div class="pce-kitahe-script-list">${scriptCheckboxRows(state)}</div>
          </div>
          <div class="pce-kitahe-source-options">
            <label class="form-group">
              <span class="form-label">Entry SCR</span>
              <select class="form-select" data-kitahe-field="entry" ${state.selectedScripts.size ? '' : 'disabled'}>${entryOptions(state)}</select>
            </label>
            <label class="form-group">
              <span class="form-label">主人公名（NAME 置換）</span>
              <input class="form-input" data-kitahe-field="protagonist" maxlength="16"
                value="${esc(state.protagonistName)}" placeholder="${DEFAULT_PROTAGONIST_NAME}" />
            </label>
            <p class="pce-kitahe-help">選択外 SCR への GOTO は警告付き終端になります。画像・音声のバイナリ変換は行いません。</p>
          </div>
        </div>
      ` : ''}
    </section>
  `;
}

function mappingStepHtml(state) {
  return `
    <section class="pce-kitahe-step">
      <div class="pce-kitahe-section-head">
        <div><span>2</span><h3>アセットの対応</h3></div>
        <button class="btn-sm" type="button" data-kitahe-action="reset-asset-mappings"
          ${state.busy ? 'disabled' : ''}>アセット対応をリセットして自動照合</button>
      </div>
      <p class="pce-kitahe-help">すべてのメッセージをナレーションとして変換し、COLOR値は本文色へ反映します。</p>
      <h4>画像・音声</h4>
      <p class="pce-kitahe-help">
        source名と登録済みPCE asset名が一致する参照は自動選択されます。
        カード右上のチェックをOFFにすると、その参照を明示的に省略します。
      </p>
      <div class="pce-kitahe-mapping-list">${assetMappingRows(state)}</div>
    </section>
  `;
}

function previewStepHtml(state) {
  const requirements = normalizeAssetRequirements(state.inspection);
  const diagnostics = asArray(state.inspection?.diagnostics);
  const counts = diagnosticCounts(diagnostics);
  state.previewDiagnostics = diagnostics;
  return `
    <section class="pce-kitahe-step">
      <div class="pce-kitahe-section-head"><div><span>3</span><h3>変換プレビューと診断</h3></div></div>
      <div class="pce-kitahe-summary-cards">
        <div><strong>${state.selectedScripts.size}</strong><span>SCR</span></div>
        <div><strong>${normalizeColorTokens(state.inspection).length}</strong><span>COLOR token</span></div>
        <div><strong>${requirements.length}</strong><span>asset 参照</span></div>
        <div data-level="${counts.error ? 'error' : (counts.warning ? 'warning' : 'ok')}">
          <strong>${counts.error} / ${counts.warning}</strong><span>error / warning</span>
        </div>
      </div>
      ${summaryRows(state.inspection?.summary).length ? `
        <dl class="pce-kitahe-summary-list">
          ${summaryRows(state.inspection.summary).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}
        </dl>
      ` : ''}
      ${summaryRows(state.inspection?.totals).length ? `
        <h4>Totals</h4>
        <dl class="pce-kitahe-summary-list">
          ${summaryRows(state.inspection.totals).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}
        </dl>
      ` : ''}
      ${modePreviewsHtml(state.inspection?.modePreviews)}
      ${sceneBudgetsHtml(state.inspection?.sceneBudgets)}
      ${diagnosticRows(diagnostics)}
    </section>
  `;
}

function confirmStepHtml(state) {
  const counts = diagnosticCounts(state.previewDiagnostics || state.inspection?.diagnostics);
  return `
    <section class="pce-kitahe-step">
      <div class="pce-kitahe-section-head"><div><span>4</span><h3>適用方法を確認</h3></div></div>
      <div class="pce-kitahe-mode-grid">
        <label class="${state.mode === 'replace' ? 'is-selected' : ''}">
          <input type="radio" name="kitahe-mode" value="replace" ${state.mode === 'replace' ? 'checked' : ''} />
          <strong>置換</strong>
          <span>現在の scene をバックアップ後、変換結果で置き換えます。import entry が startScene になります。</span>
        </label>
        <label class="${state.mode === 'append' ? 'is-selected' : ''}">
          <input type="radio" name="kitahe-mode" value="append" ${state.mode === 'append' ? 'checked' : ''} />
          <strong>追加</strong>
          <span>変換専用 namespace で scene を追加・更新し、既存 scene を残します。</span>
        </label>
      </div>
      ${state.mode === 'append' ? `
        <label class="pce-kitahe-check">
          <input type="checkbox" data-kitahe-field="set-start" ${state.setStartScene ? 'checked' : ''} />
          <span>import entry を startScene に切り替える</span>
        </label>
      ` : ''}
      ${counts.warning ? `
        <label class="pce-kitahe-check pce-kitahe-warning-check">
          <input type="checkbox" data-kitahe-field="confirm-warnings" ${state.warningConfirmed ? 'checked' : ''} />
          <span>${counts.warning} 件の警告と近似・省略内容を確認しました</span>
        </label>
      ` : ''}
      <p class="pce-kitahe-help">
        適用時に source・mapping・asset catalog・scene を再検査します。確認後に入力が変わっていれば適用せず停止します。
      </p>
    </section>
  `;
}

function renderModal(modal, state, options = {}) {
  const previousBody = modal.panel.querySelector('.pce-kitahe-body');
  const bodyScroll = options.preserveBodyScroll === true && previousBody
    ? { top: previousBody.scrollTop, left: previousBody.scrollLeft }
    : null;
  const previousScriptList = modal.panel.querySelector('.pce-kitahe-script-list');
  const scriptListScroll = options.preserveScriptListScroll === true && previousScriptList
    ? { top: previousScriptList.scrollTop, left: previousScriptList.scrollLeft }
    : null;
  const labels = ['SCR', 'Mapping', 'Preview', 'Apply'];
  const body = state.step === 0
    ? sourceStepHtml(state)
    : (state.step === 1
      ? mappingStepHtml(state)
      : (state.step === 2 ? previewStepHtml(state) : confirmStepHtml(state)));
  const previewCounts = diagnosticCounts(state.previewDiagnostics || state.inspection?.diagnostics);
  const canApply = state.step === 3
    && previewCounts.error === 0
    && (!previewCounts.warning || state.warningConfirmed);
  modal.panel.innerHTML = `
    <div class="page-header modal-header">
      <div>
        <h2 id="pce-kitahe-import-title">北へ。PhotoMemories 取込</h2>
        <p>SCR を PC Engine CD-ROM2 VN scene へ変換</p>
      </div>
      <button class="icon-btn" type="button" data-kitahe-action="cancel" aria-label="閉じる" ${state.busy ? 'disabled' : ''}>✕</button>
    </div>
    <div class="pce-kitahe-progress" aria-label="取込手順">
      ${labels.map((label, index) => `
        <span class="${index === state.step ? 'active' : ''}${index < state.step ? ' complete' : ''}">
          <b>${index + 1}</b>${label}
        </span>
      `).join('')}
    </div>
    <div class="pce-kitahe-body">
      ${body}
      <div class="form-error pce-kitahe-status" data-level="${esc(state.statusLevel || '')}">${esc(state.status || '')}</div>
    </div>
    <div class="pce-kitahe-footer">
      <button class="btn-sm" type="button" data-kitahe-action="cancel" ${state.busy ? 'disabled' : ''}>キャンセル</button>
      <div>
        ${state.step > 0 ? `<button class="btn-sm" type="button" data-kitahe-action="back" ${state.busy ? 'disabled' : ''}>戻る</button>` : ''}
        ${state.step === 0
          ? `<button class="btn-primary" type="button" data-kitahe-action="inspect"
              ${state.busy || state.targetMedia !== 'cd' || !state.sourceRoot || !state.selectedScripts.size ? 'disabled' : ''}>${state.busy ? '検査中…' : '選択 SCR を検査'}</button>`
          : ''}
        ${state.step === 1
          ? `<button class="btn-primary" type="button" data-kitahe-action="preview" ${state.busy ? 'disabled' : ''}>${state.busy ? '変換preview中…' : '診断プレビュー'}</button>`
          : ''}
        ${state.step === 2
          ? `<button class="btn-primary" type="button" data-kitahe-action="confirm"
              ${previewCounts.error || state.busy ? 'disabled' : ''}>適用方法へ</button>`
          : ''}
        ${state.step === 3
          ? `<button class="btn-primary" type="button" data-kitahe-action="apply"
              ${!canApply || state.busy ? 'disabled' : ''}>${state.busy ? '適用中…' : '変換を適用'}</button>`
          : ''}
      </div>
    </div>
  `;
  if (state.busy) {
    modal.panel.querySelectorAll('.pce-kitahe-step input, .pce-kitahe-step select, .pce-kitahe-step button')
      .forEach((control) => { control.disabled = true; });
  }
  if (bodyScroll) {
    const nextBody = modal.panel.querySelector('.pce-kitahe-body');
    if (nextBody) {
      nextBody.scrollTop = bodyScroll.top;
      nextBody.scrollLeft = bodyScroll.left;
    }
  }
  if (scriptListScroll) {
    const nextScriptList = modal.panel.querySelector('.pce-kitahe-script-list');
    if (nextScriptList) {
      nextScriptList.scrollTop = scriptListScroll.top;
      nextScriptList.scrollLeft = scriptListScroll.left;
    }
  }
}

function collectMappingChange(target, state) {

  const requirements = normalizeAssetRequirements(state.inspection);
  const indexed = (attribute, rows) => {
    const raw = target.getAttribute(attribute);
    if (raw == null) return null;
    return rows[Number(raw)] || null;
  };

  const mapEnabled = indexed('data-map-enabled', requirements);
  if (mapEnabled) {
    const current = state.assetMappings[mapEnabled.key] || defaultAssetMapping(mapEnabled);
    current.action = target.checked ? 'map' : 'omit';
    if (current.action === 'map' && !current.assetId && mapEnabled.suggestedAssetId) {
      current.assetId = String(mapEnabled.suggestedAssetId);
      if (mapEnabled.kind === 'visual' && mapEnabled.suggestedAssetType === 'sprite') {
        current.display = 'sprite';
      }
    }
    state.assetMappings[mapEnabled.key] = current;
    return true;
  }

  const fields = [
    ['data-map-display', 'display'],
    ['data-map-asset', 'assetId'],
    ['data-map-x', 'x'],
    ['data-map-y', 'y'],
    ['data-map-slot', 'slot'],
    ['data-map-animation', 'animationId'],
  ];
  for (const [attribute, field] of fields) {
    const requirement = indexed(attribute, requirements);
    if (!requirement) continue;
    const current = state.assetMappings[requirement.key] || defaultAssetMapping(requirement);
    current[field] = ['x', 'y', 'slot'].includes(field) ? asInteger(target.value, current[field]) : String(target.value || '');
    if (field === 'display') {
      current.assetId = '';
      current.animationId = '';
      if (current.display === 'background') {
        current.x = 2;
        current.y = 1;
      }
    }
    if (field === 'assetId') current.animationId = '';
    state.assetMappings[requirement.key] = current;
    return ['action', 'display', 'assetId'].includes(field);
  }
  return false;
}

function validateMappings(state) {
  const errors = [];
  normalizeAssetRequirements(state.inspection).forEach((requirement) => {
    const mapping = state.assetMappings[requirement.key];
    if (!mapping || !['map', 'omit'].includes(mapping.action)) {
      errors.push(`${requirement.label}: 対応または省略を選択してください。`);
      return;
    }
    if (mapping.action === 'omit') return;
    const asset = state.assets.find((entry) => String(entry?.id || '') === String(mapping.assetId || ''));
    if (!asset) {
      errors.push(`${requirement.label}: PCE asset を選択してください。`);
      return;
    }
    const accepted = acceptedAssetTypes(requirement, mapping);
    if (!accepted.includes(String(asset.type || ''))) {
      errors.push(`${requirement.label}: ${accepted.join(' / ')} asset が必要です。`);
    }
  });
  return errors;
}

function compactAssetMappings(state) {
  return Object.fromEntries(normalizeAssetRequirements(state.inspection).map((requirement) => {
    const current = state.assetMappings[requirement.key] || { action: '' };
    if (current.action === 'omit') return [requirement.key, { action: 'omit' }];
    const mapped = { action: 'map', assetId: String(current.assetId || '') };
    if (requirement.kind === 'visual') {
      mapped.display = current.display === 'sprite' ? 'sprite' : 'background';
      if (mapped.display === 'sprite') {
        mapped.slot = Math.max(0, Math.min(3, asInteger(current.slot, 0)));
        if (current.animationId) mapped.animationId = String(current.animationId);
      } else {
        mapped.x = asInteger(current.x, 2);
        mapped.y = asInteger(current.y, 1);
      }
    }
    return [requirement.key, mapped];
  }));
}

export function activatePlugin({ plugin, api, logger, registerCapability }) {
  let activeSession = null;

  const invoke = async (hook, payload) => {
    const result = await api.plugins.invokeHook(PLUGIN_ID, hook, payload);
    if (!result?.ok) {
      const error = new Error(result?.error || `${hook} に失敗しました`);
      error.result = result;
      throw error;
    }
    return result?.result && typeof result.result === 'object' ? result.result : result;
  };

  const assetPackageImporter = createKitahePmAssetPackageImporter({
    plugin,
    api,
    logger,
    invoke,
  });

  const openImportModal = (options = {}) => {
    if (activeSession) {
      activeSession.modal.open();
      return activeSession.promise;
    }

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const modal = api.createModal({
      id: `${plugin?.id || PLUGIN_ID}-import-${Date.now()}`,
      panelClassName: 'app-panel pce-kitahe-import-panel',
      labelledBy: 'pce-kitahe-import-title',
    });
    const state = {
      step: 0,
      busy: false,
      sourceRoot: '',
      scripts: [],
      selectedScripts: new Set(),
      entryScript: '',
      protagonistName: DEFAULT_PROTAGONIST_NAME,
      protagonistNameTouched: false,
      inspection: null,

      assetMappings: Object.create(null),
      assets: asArray(options.assets),
      doc: options.doc && typeof options.doc === 'object'
        ? JSON.parse(JSON.stringify(options.doc))
        : { startScene: 'opening', scenes: [] },
      targetMedia: String(options.targetMedia || '').toLowerCase(),
      mode: 'replace',
      setStartScene: false,
      warningConfirmed: false,
      previewDiagnostics: [],
      previewMode: '',
      previewSetStartScene: false,
      status: '',
      statusLevel: '',
    };
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown);
      modal.close();
      modal.destroy?.();
      activeSession = null;
      resolvePromise(result);
    };
    const cancel = () => {
      logger?.info?.('北へ。PM取込をキャンセルしました。');
      finish({ ok: false, canceled: true });
    };
    const setStatus = (message, level = '') => {
      state.status = String(message || '');
      state.statusLevel = level;
    };
    const invalidateMappedPreview = (message = '適用方法を変更したため再プレビューしてください') => {
      state.inspection = { ...state.inspection, signature: '' };
      state.previewDiagnostics = [];
      state.previewMode = '';
      state.previewSetStartScene = false;
      state.warningConfirmed = false;
      state.step = 1;
      setStatus(message, 'info');
    };
    const fail = (error, prefix = '北へ。PM取込失敗') => {
      const message = `${prefix}: ${String(error?.message || error)}`;
      setStatus(message, 'error');
      logger?.error?.(message);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !state.busy) cancel();
    };

    const inspectPayload = () => ({
      sourceRoot: state.sourceRoot,
      selectedScripts: Array.from(state.selectedScripts),
      entryScript: state.entryScript || undefined,
      ...(state.protagonistNameTouched ? { protagonistName: state.protagonistName } : {}),
      doc: state.doc,
      targetMedia: state.targetMedia,
    });

    const pickRoot = async () => {
      const picked = await api.electronAPI.pickFile({
        title: '北へ。PhotoMemories resource root を選択',
        properties: ['openDirectory'],
      });
      const sourceRoot = picked?.sourcePath || picked?.filePaths?.[0] || '';
      if (picked?.canceled || !sourceRoot) return;
      state.busy = true;
      state.sourceRoot = sourceRoot;
      state.scripts = [];
      state.selectedScripts = new Set();
      state.entryScript = '';
      state.protagonistName = DEFAULT_PROTAGONIST_NAME;
      state.protagonistNameTouched = false;
      state.inspection = null;
      setStatus('SCRIPT を検索しています…');
      renderModal(modal, state);
      try {
        const inspection = await invoke('inspectKitahePmSource', {
          ...inspectPayload(),
          selectedScripts: [],
          entryScript: undefined,
        });
        state.inspection = inspection;
        state.scripts = asArray(inspection?.scripts);
        const discoveredScriptValues = state.scripts.map(scriptValue).filter(Boolean);
        state.selectedScripts = new Set(discoveredScriptValues);
        state.entryScript = discoveredScriptValues[0] || '';
        state.protagonistName = String(
          inspection?.protagonistName ?? DEFAULT_PROTAGONIST_NAME,
        ).slice(0, 16);
        setStatus(`${state.scripts.length} 件の SCR を検出しました。`, 'info');
        logger?.info?.(`北へ。PM source検査: SCR ${state.scripts.length}件`);
      } catch (error) {
        state.scripts = [];
        fail(error, 'Resource root検査失敗');
      } finally {
        state.busy = false;
        renderModal(modal, state);
      }
    };

    const inspectSelected = async () => {
      if (!state.selectedScripts.size) {
        setStatus('SCR を1件以上選択してください。', 'error');
        renderModal(modal, state);
        return;
      }
      state.busy = true;
      setStatus('選択した SCR を解析しています…');
      renderModal(modal, state);
      try {
        const inspection = await invoke('inspectKitahePmSource', inspectPayload());
        state.inspection = inspection;
        state.entryScript = String(inspection?.entryScript || state.entryScript || '');
        state.protagonistName = String(
          inspection?.protagonistName ?? state.protagonistName,
        ).slice(0, 16);
        const savedMapping = inspection?.mapping || inspection?.savedMapping || {};
        const savedAssets = savedMapping?.assets && typeof savedMapping.assets === 'object'
          ? savedMapping.assets
          : {};
        state.assetMappings = Object.create(null);
        normalizeAssetRequirements(inspection).forEach((requirement) => {
          const saved = savedAssets[requirement.key];
          state.assetMappings[requirement.key] = initialAssetMapping(requirement, saved);
        });
        state.step = 1;
        setStatus('');
      } catch (error) {
        fail(error, 'SCR解析失敗');
      } finally {
        state.busy = false;
        renderModal(modal, state);
      }
    };

    const resetAssetMappings = async () => {
      if (!state.inspection || !state.selectedScripts.size || state.busy) return;
      const previousInspection = state.inspection;
      const previousAssets = state.assets;
      const previousMappings = state.assetMappings;
      state.busy = true;
      setStatus('最新の登録済みassetから対応を自動照合しています…');
      renderModal(modal, state, { preserveBodyScroll: true });
      try {
        const assetResult = await api.assets.listPceAssets({ force: true });
        if (!assetResult?.ok) {
          throw new Error(assetResult?.error || 'asset一覧を更新できませんでした');
        }
        const inspection = await invoke('inspectKitahePmSource', inspectPayload());
        state.assets = asArray(assetResult.assets);
        state.inspection = {
          ...previousInspection,
          ...inspection,
          signature: '',
        };
        state.assetMappings = Object.create(null);
        const requirements = normalizeAssetRequirements(inspection);
        requirements.forEach((requirement) => {
          state.assetMappings[requirement.key] = defaultAssetMapping(requirement);
        });
        invalidateMappedPreview('');
        const mappedCount = requirements.filter(
          (requirement) => state.assetMappings[requirement.key]?.action === 'map',
        ).length;
        setStatus(
          `アセット対応を自動照合しました（対応 ${mappedCount}件 / 省略 ${requirements.length - mappedCount}件）。`
          + ' 保存済み設定は変換適用時に更新されます。',
          'info',
        );
      } catch (error) {
        state.inspection = previousInspection;
        state.assets = previousAssets;
        state.assetMappings = previousMappings;
        fail(error, 'アセット対応のリセット失敗');
      } finally {
        state.busy = false;
        renderModal(modal, state, { preserveBodyScroll: true });
      }
    };

    const showPreview = async () => {
      const errors = validateMappings(state);
      if (errors.length) {
        setStatus(errors.slice(0, 4).join('\n'), 'error');
        renderModal(modal, state);
        return;
      }
      const previousInspection = state.inspection;
      const mapping = {
        speakers: {},
        assets: compactAssetMappings(state),
      };
      state.busy = true;
      state.previewDiagnostics = [];
      state.inspection = { ...state.inspection, signature: '' };
      state.previewMode = '';
      state.previewSetStartScene = false;
      setStatus('mapping を反映した変換結果と scene budget を検査しています…');
      renderModal(modal, state);
      try {
        const preview = await invoke('inspectKitahePmSource', {
          ...inspectPayload(),
          mapping,
          previewConversion: true,
          mode: state.mode,
          setStartScene: state.mode === 'replace' ? true : state.setStartScene,
        });
        const previewSignature = String(preview?.signature || preview?.previewSignature || '');
        if (!previewSignature) throw new Error('mapping preview signature がありません');
        state.inspection = {
          ...previousInspection,
          ...preview,
          signature: previewSignature,
          colorTokens: Array.isArray(preview?.colorTokens)
            ? preview.colorTokens
            : previousInspection?.colorTokens,
          assetRequirements: Array.isArray(preview?.assetRequirements)
            ? preview.assetRequirements
            : previousInspection?.assetRequirements,
          entryCandidates: Array.isArray(preview?.entryCandidates)
            ? preview.entryCandidates
            : previousInspection?.entryCandidates,
          selectedScripts: Array.isArray(preview?.selectedScripts)
            ? preview.selectedScripts
            : previousInspection?.selectedScripts,
        };
        state.previewMode = state.mode;
        state.previewSetStartScene = state.mode === 'replace' ? true : state.setStartScene;
        state.step = 2;
        state.warningConfirmed = false;
        setStatus('');
      } catch (error) {
        const returnedDiagnostics = asArray(error?.result?.diagnostics);
        const details = returnedDiagnostics.slice(0, 3).map(diagnosticMessage).filter(Boolean);
        const message = details.length
          ? `${error?.message || error}\n${details.join('\n')}`
          : (error?.message || error);
        fail(message, '変換preview失敗');
      } finally {
        state.busy = false;
        renderModal(modal, state);
      }
    };

    const applyConversion = async () => {
      const counts = diagnosticCounts(state.previewDiagnostics || state.inspection?.diagnostics);
      const requestedSetStartScene = state.mode === 'replace' ? true : state.setStartScene;
      if (!state.inspection?.signature
        || state.previewMode !== state.mode
        || state.previewSetStartScene !== requestedSetStartScene) {
        invalidateMappedPreview();
        renderModal(modal, state);
        return;
      }
      if (counts.error) return;
      if (counts.warning && !state.warningConfirmed) {
        setStatus('警告と近似・省略内容の確認が必要です。', 'error');
        renderModal(modal, state);
        return;
      }
      const mappingErrors = validateMappings(state);
      if (mappingErrors.length) {
        state.step = 1;
        setStatus(mappingErrors.slice(0, 4).join('\n'), 'error');
        renderModal(modal, state);
        return;
      }

      state.busy = true;
      setStatus('source・asset・scene を再検査して適用しています…');
      renderModal(modal, state);
      try {
        const result = await invoke('applyKitahePmConversion', {
          ...inspectPayload(),
          signature: state.inspection?.signature,
          mapping: {
            speakers: {},
            assets: compactAssetMappings(state),
          },
          mode: state.mode,
          setStartScene: requestedSetStartScene,
          confirmWarnings: counts.warning > 0 && state.warningConfirmed,
        });
        if (!result?.doc || !Array.isArray(result.doc.scenes)) {
          throw new Error('変換結果に VN scene document がありません');
        }
        const importedCount = asArray(result.importedSceneIds).length;
        logger?.info?.(`北へ。PM取込完了: ${importedCount} scene`);
        finish({ ...result, ok: true });
      } catch (error) {
        if (asArray(error?.result?.diagnostics).length) {
          state.inspection = {
            ...state.inspection,
            diagnostics: error.result.diagnostics,
            summary: error.result.totals || state.inspection?.summary,
          };
          state.step = 2;
        }
        fail(error);
        state.busy = false;
        renderModal(modal, state);
      }
    };

    modal.panel.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-kitahe-action]')?.dataset?.kitaheAction;
      if (!action) return;
      if (action === 'cancel') cancel();
      else if (action === 'pick-root') void pickRoot();
      else if (action === 'inspect') void inspectSelected();
      else if (action === 'reset-asset-mappings') void resetAssetMappings();
      else if (action === 'preview') void showPreview();
      else if (action === 'confirm') {
        state.step = 3;
        setStatus('');
        renderModal(modal, state);
      } else if (action === 'back') {
        state.step = Math.max(0, state.step - 1);
        setStatus('');
        renderModal(modal, state);
      } else if (action === 'apply') {
        void applyConversion();
      }
    });

    modal.panel.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
      const scriptIndex = target.getAttribute('data-script-index');
      if (scriptIndex != null) {
        const value = scriptValue(state.scripts[Number(scriptIndex)]);
        if (target.checked) state.selectedScripts.add(value);
        else state.selectedScripts.delete(value);
        if (!state.selectedScripts.has(state.entryScript)) state.entryScript = Array.from(state.selectedScripts)[0] || '';
        renderModal(modal, state, {
          preserveBodyScroll: true,
          preserveScriptListScroll: true,
        });
        return;
      }
      if (target.dataset.kitaheField === 'entry') state.entryScript = target.value;
      else if (target.dataset.kitaheField === 'set-start') {
        state.setStartScene = target.checked;
        invalidateMappedPreview();
        renderModal(modal, state);
        return;
      } else if (target.dataset.kitaheField === 'confirm-warnings') state.warningConfirmed = target.checked;
      else if (target.name === 'kitahe-mode') {
        state.mode = target.value === 'append' ? 'append' : 'replace';
        invalidateMappedPreview();
        renderModal(modal, state);
        return;
      } else if (collectMappingChange(target, state)) {
        renderModal(modal, state, { preserveBodyScroll: true });
        return;
      }
      if (state.step === 3) renderModal(modal, state);
    });

    modal.panel.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.kitaheField === 'protagonist') {
        state.protagonistName = String(target.value || '').slice(0, 16);
        state.protagonistNameTouched = true;
        return;
      }
      collectMappingChange(target, state);
    });

    modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', cancel);
    window.addEventListener('keydown', onKeyDown);
    activeSession = { modal, promise, finish };
    if (state.targetMedia !== 'cd') {
      setStatus('このコンバーターは CD-ROM2 VN プロジェクト専用です。', 'error');
    }
    renderModal(modal, state);
    modal.open();
    return promise;
  };

  const runNovelToolbarAction = async (editor = {}) => {
    try {
      if (editor.targetMedia !== 'cd') {
        throw new Error('北へ。PM取込は CD-ROM2 VN プロジェクト専用です。');
      }
      if (typeof editor.getSnapshot !== 'function'
        || typeof editor.getAssets !== 'function'
        || typeof editor.saveSnapshot !== 'function'
        || typeof editor.applyDocument !== 'function') {
        throw new Error('Novel editorのplugin action APIが不足しています');
      }
      const snapshot = await editor.getSnapshot({ refreshAssets: true });
      await editor.saveSnapshot(snapshot);
      const result = await openImportModal({
        doc: snapshot,
        assets: editor.getAssets(),
        targetMedia: editor.targetMedia,
      });
      if (result?.canceled) return { ok: true, canceled: true };
      if (!result?.ok) throw new Error(result?.error || '変換結果を取得できませんでした');
      if (!result.doc || !Array.isArray(result.doc.scenes)) {
        throw new Error('変換結果に VN scene document がありません');
      }
      editor.applyDocument(result.doc, {
        preferredSceneIds: result.importedSceneIds,
        startScene: result.startScene,
      });
      const count = Array.isArray(result.importedSceneIds) ? result.importedSceneIds.length : 0;
      const message = `北へ。PM取込を適用しました: ${count} scene`;
      logger?.info?.(message);
      return { ok: true, message };
    } catch (error) {
      logger?.error?.(`北へ。PM取込失敗: ${error?.message || error}`);
      throw error;
    }
  };

  registerCapability(CAPABILITY_NAME, { openImportModal });
  registerCapability('novel-toolbar-action', {
    id: 'kitahe-pm-import',
    pluginId: plugin.id,
    label: '北へ。PM取込',
    title: '北へ。PhotoMemories の SCR をCD-ROM2 VNシーンへ変換',
    priority: 100,
    order: 10,
    placement: 'before-preview',
    supportedTargetMedia: ['cd'],
    run: runNovelToolbarAction,
  });
  registerCapability('kitahe-pm-asset-importer', {
    pluginId: plugin.id,
    openImportModal: assetPackageImporter.open,
  });
  registerCapability('asset-batch-importer', {
    id: 'kitahe-pm-assets',
    pluginId: plugin.id,
    label: '北へ。PM素材',
    title: 'Viewerが出力した北へ。PM asset packageを一括登録',
    priority: 100,
    order: 20,
    supportedTargetMedia: ['cd'],
    disabledReason: '北へ。PM素材の一括取込はCD-ROM2 project専用です',
    open: assetPackageImporter.open,
  });
  return {
    deactivate() {
      activeSession?.finish?.({ ok: false, canceled: true });
      activeSession = null;
      assetPackageImporter.destroy();
    },
  };
}
