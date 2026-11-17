'use strict';

/* =========================================================================
   mt_v3 — единый редактор XML-заданий.

   Один интерфейс и одно ядро (файлы, сохранение, публикация, промпты, AI),
   три разных редактора по типу XML:
     • rt — Reading Test (<readingTest>)   → тестирование test/rt
     • mt — Moodle Quiz (<quiz>)           → тестирование test/mt
     • ft — Formula Test (<formulas>)      → тестирование test/ft

   Ссылка на опубликованное задание ведёт в единую точку входа тестирования
   test/index.html?file=… — там один раз вводятся ФИО и группа, а тип задания
   определяется по корню XML.

   Файлы и публикация — save_api/file-api.js, режимы — save_api/prompts-api.js.
   ========================================================================= */

(function () {
    const els = {};
    const LS = {
        type: 'mtV3_active_type',
        settings: 'mtV3_settings',
        meta: 'mtV3_meta',
    };
    const META_KEYS = ['author', 'university', 'discipline', 'audience'];
    const DEFAULTS = {
        gh: '', gv: '', server: '', ds: '',
        endpoint: '', folder: '',
        autosave: true,
    };

    const state = {
        typeId: '',
        adapter: null,
        editor: null,
        files: null,
        prompts: null,
        filesCache: {},
        promptsCache: {},
        settings: loadSettings(),
        meta: loadMeta(),
        dirty: false,
        xmlDirty: false,
        busy: false,
        flags: { checkmode: false, headershow: false, crushmode: false, randommode: false },
        lastPublish: null,
        preview: { on: false, index: 0, showAnswers: false },
    };

    /* ------------------------------ Настройки ------------------------------ */

    function loadSettings() {
        try {
            return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS.settings) || '{}'));
        } catch (e) {
            return Object.assign({}, DEFAULTS);
        }
    }

    function saveSettings() {
        try { localStorage.setItem(LS.settings, JSON.stringify(state.settings)); } catch (e) { /* ignore */ }
    }

    /* ------------------------- Метаданные задания ------------------------- */

    // Как в rt_v2: автор/университет/дисциплина/аудитория хранятся в
    // localStorage и автоматически подставляются в новое задание любого типа.
    function loadMeta() {
        const out = {};
        META_KEYS.forEach(key => { out[key] = ''; });
        try {
            const raw = JSON.parse(localStorage.getItem(LS.meta) || '{}');
            META_KEYS.forEach(key => { out[key] = String(raw[key] || ''); });
        } catch (e) { /* повреждённое значение — пустые поля */ }
        return out;
    }

    function saveMeta(meta) {
        META_KEYS.forEach(key => {
            if (meta && typeof meta[key] === 'string') state.meta[key] = meta[key];
        });
        try { localStorage.setItem(LS.meta, JSON.stringify(state.meta)); } catch (e) { /* ignore */ }
    }

    // Подставить сохранённые метаданные в пустую модель нового задания.
    function applyStoredMeta(model) {
        if (!model || !model.meta) return model;
        META_KEYS.forEach(key => { model.meta[key] = state.meta[key] || ''; });
        return model;
    }

    // Запомнить непустые метаданные из разобранного XML (как в rt_v2).
    function rememberMeta(model) {
        if (!model || !model.meta) return;
        const filled = {};
        META_KEYS.forEach(key => {
            const value = String(model.meta[key] || '').trim();
            if (value) filled[key] = value;
        });
        if (Object.keys(filled).length) saveMeta(filled);
    }

    /* -------------------------------- Утилиты -------------------------------- */

    function id(name) { return document.getElementById(name); }

    function setStatus(text, isError) {
        if (!els.statusText) return;
        els.statusText.textContent = text || '';
        els.statusText.classList.toggle('error', !!isError);
    }

    let toastTimer = null;
    function toast(message, isError) {
        const box = els.toast;
        if (!box) return;
        box.textContent = message;
        box.classList.toggle('error', !!isError);
        box.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => box.classList.remove('show'), isError ? 5000 : 2800);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            toast('Скопировано');
        } catch (e) {
            toast('Не удалось скопировать: ' + e.message, true);
        }
    }

    /* ------------------------------- Типы XML ------------------------------- */

    function renderTypeTabs() {
        els.typeTabs.innerHTML = window.MtV3Types.list().map(type =>
            '<button type="button" class="type-tab' + (type.id === state.typeId ? ' active' : '') +
            '" data-type="' + type.id + '">' +
            '<span class="type-short">' + type.short + '</span>' +
            '<span class="type-label">' + type.label + '</span></button>').join('');
    }

    function switchType(typeId, opts) {
        const adapter = window.MtV3Types.get(typeId);
        if (!adapter) return;
        if (!opts || !opts.force) {
            if (state.dirty) {
                confirmDialog('В текущем задании есть изменения. Переключить тип без сохранения?',
                    { okLabel: 'Переключить' }).then(ok => {
                    if (ok) switchType(typeId, { force: true, blank: true });
                });
                return;
            }
        }
        setPreview(false);

        state.typeId = typeId;
        state.adapter = adapter;
        state.files = filesFor(typeId);
        state.prompts = promptsFor(typeId);

        const blank = !opts || opts.blank !== false;
        const model = blank && adapter.blank
            ? applyStoredMeta(adapter.blank())
            : adapter.parse(adapter.sample());
        els.typeEditor.innerHTML = '';
        state.editor = adapter.createEditor(els.typeEditor, {
            changed: onModelChanged,
            toast: toast,
            confirm: confirmDialog,
        });
        state.editor.setModel(model);
        state.editor.render();

        state.dirty = false;
        state.xmlDirty = false;
        state.lastPublish = state.files.getLastPublish();
        setXml(blank ? '' : adapter.build(state.editor.getModel()), true);
        state.files.setContent(els.xmlEditor.value, { silent: true });

        renderTypeTabs();
        updateHeader();
        updateCounts();
        refreshIssues();
        updateSaveInfo();
        updatePublishInfo();
        updatePromptLabel();
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'синхронизировано';
        localStorage.setItem(LS.type, typeId);
        setStatus('Готово: ' + adapter.label);
    }

    function updateHeader() {
        if (!state.adapter || !state.editor) return;
        const mode = state.prompts && state.prompts.getActivePrompt ? state.prompts.getActivePrompt() : null;
        const title = state.adapter.label + (mode && mode.name ? ' — ' + mode.name : '');
        els.editorTitle.textContent = title;
        els.editorTitle.title = title;
        els.editorMeta.textContent = state.adapter.stats(state.editor.getModel());
    }

    function updateCounts() {
        if (!state.adapter || !state.editor) return;
        els.statusCounts.textContent = state.adapter.stats(state.editor.getModel());
    }

    function updatePromptLabel() {
        const prompt = state.prompts && state.prompts.getActivePrompt();
        els.statusPrompt.textContent = 'Режим: ' + (prompt ? prompt.name : '—');
        updateHeader();
    }

    /* ------------------------------- Просмотр ------------------------------- */

    function setPreview(on) {
        state.preview.on = !!on;
        if (els.previewPane) els.previewPane.classList.toggle('hidden', !on);
        if (els.typeEditor) els.typeEditor.classList.toggle('hidden', on);
        if (els.btnPreview) {
            els.btnPreview.classList.toggle('active', on);
            els.btnPreview.textContent = on ? '✎ Редактор' : '👁 Просмотр';
        }
        if (!on) return;
        state.preview.index = state.editor && state.editor.getIndex ? state.editor.getIndex() : 0;
        state.preview.showAnswers = els.pvShowAnswers ? els.pvShowAnswers.checked : false;
        renderPreview();
    }

    function previewStep(delta) {
        if (!state.preview.on) return;
        const count = state.adapter.count ? state.adapter.count(state.editor.getModel()) : 1;
        state.preview.index = Math.max(0, Math.min(state.preview.index + delta, count - 1));
        renderPreview();
    }

    function renderPreview() {
        if (!state.preview.on || !state.adapter || !state.editor) return;
        const model = state.editor.getModel();
        const count = Math.max(1, state.adapter.count ? state.adapter.count(model) : 1);
        const index = Math.max(0, Math.min(state.preview.index, count - 1));
        state.preview.index = index;

        els.pvStage.innerHTML = state.adapter.preview
            ? state.adapter.preview(model, index, { showAnswers: state.preview.showAnswers })
            : '<p class="hint">Для этого типа просмотр не реализован.</p>';
        els.pvCounter.textContent = (index + 1) + ' / ' + count;
        els.pvLabel.textContent = state.adapter.itemLabel ? state.adapter.itemLabel(index) : 'так увидит студент';
        els.pvPrev.disabled = index <= 0;
        els.pvNext.disabled = index >= count - 1;

        // KaTeX — для формул с data-latex, затем MathJax — для HTML с \\( \\)
        els.pvStage.querySelectorAll('[data-latex]').forEach(node => {
            const latex = node.getAttribute('data-latex') || '';
            if (window.katex && typeof window.katex.render === 'function') {
                try {
                    window.katex.render(latex, node, {
                        throwOnError: false,
                        displayMode: node.getAttribute('data-display') !== 'inline',
                    });
                    return;
                } catch (e) { /* покажем текстом */ }
            }
            node.textContent = latex;
        });
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            window.MathJax.typesetPromise([els.pvStage]).catch(() => {});
        }
    }

    /* ------------------------------- XML-панель ------------------------------- */

    function setXml(text, force) {
        if (!force && document.activeElement === els.xmlEditor) return;
        els.xmlEditor.value = text;
        syncXmlEmpty();
    }

    // Подсказка в пустой XML-панели: исчезает, как только появился любой текст.
    function syncXmlEmpty() {
        if (!els.xmlEmpty) return;
        const empty = !els.xmlEditor.value.trim();
        els.xmlEmpty.classList.toggle('hidden', !empty);
    }

    function onModelChanged() {
        if (!state.adapter || !state.editor) return;
        const model = state.editor.getModel();
        const xml = state.adapter.build(model);
        setXml(xml, true);
        state.files.setContent(xml);
        if (model && model.meta) saveMeta(model.meta);
        state.dirty = true;
        state.xmlDirty = false;
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'синхронизировано';
        updateHeader();
        updateCounts();
        refreshIssues();
        if (state.preview.on) renderPreview();
    }

    function applyXml() {
        if (!state.adapter) return;
        const text = els.xmlEditor.value;
        let model;
        try {
            model = state.adapter.parse(text);
        } catch (e) {
            toast('Ошибка разбора XML: ' + e.message, true);
            setStatus('XML не применён: ' + e.message, true);
            return false;
        }
        state.editor.setModel(model);
        state.editor.render();
        rememberMeta(model);
        state.files.setContent(text);
        state.dirty = true;
        state.xmlDirty = false;
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'применено';
        updateHeader();
        updateCounts();
        refreshIssues();
        toast('XML применён к редактору');
        if (state.preview.on) renderPreview();
        return true;
    }

    function refreshIssues() {
        if (!state.adapter || !state.editor) return;
        const issues = state.adapter.validate(state.editor.getModel()) || [];
        if (!issues.length) {
            els.issues.innerHTML = '<span class="issue ok">✓ Проверка пройдена</span>';
            return;
        }
        const errors = issues.filter(i => i.level === 'error').length;
        const warns = issues.length - errors;
        const parts = issues.slice(0, 3).map(i =>
            '<span class="issue ' + i.level + '" title="' + escapeAttr(i.text) + '">' + escapeAttr(i.text) + '</span>');
        if (issues.length > 3) parts.push('<span class="issue more">ещё ' + (issues.length - 3) + '</span>');
        if (issues.length > 3) parts.unshift('<span class="issue summary" title="' + escapeAttr(issues.map(i => i.text).join('\n')) + '">' +
            'ошибок: ' + errors + ', предупреждений: ' + warns + '</span>');
        els.issues.innerHTML = parts.join('');
    }

    function escapeAttr(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* -------------------------------- Файлы -------------------------------- */

    // Ссылка на опубликованное задание всегда ведёт в единую точку входа
    // тестирования mt_v3: test/index.html?file=<XML>&флаги. Сама страница
    // определяет тип по корню XML (readingTest / quiz / formulas) и открывает
    // нужное приложение — отдельные ссылки на rt_v2 / mt_v2 / ft не нужны.
    const TEST_ENTRY_APP = (() => {
        const fallback = 'https://tregubovvn.github.io/mt_v3/test/index.html';
        try {
            return { baseUrl: new URL('test/index.html', location.href).href, paramName: 'file' };
        } catch (e) {
            return { baseUrl: fallback, paramName: 'file' };
        }
    })();

    function filesFor(typeId) {
        if (state.filesCache[typeId]) return state.filesCache[typeId];
        const adapter = window.MtV3Types.get(typeId);
        const options = {
            gistFilename: adapter.gistFilename,
            fileName: adapter.fileBase + '.xml',
            storagePrefix: 'mtV3_' + typeId,
            taskApp: TEST_ENTRY_APP,
            collectionFilename: 'prompts.md',
            autoSaveDebounceMs: 1500,
            validate: null,
            beforePublish: content => {
                try {
                    adapter.parse(content);
                    return null;
                } catch (e) {
                    return 'XML не разобран: ' + e.message;
                }
            },
            taskTypes: ['ReadTest', 'MoodleTest', 'FormulaTest'],
            defaultTaskType: adapter.serverType,
        };
        // Пустые строки не передаём: иначе они перекроют значения по умолчанию file-api.
        if (state.settings.endpoint) options.serverEndpoint = state.settings.endpoint;
        if (state.settings.folder) options.serverFolder = state.settings.folder;
        const files = FilesApi.create(options);

        applyTokens(files);
        files.setAutosave(state.settings.autosave !== false);

        files.on('status', event => setStatus(event.message));
        // Правка содержимого снимает ссылку на задание и меняет статус публикации
        files.on('content-change', () => { updatePublishInfo(); renderPublishLink(); });
        files.on('save', () => { state.dirty = false; updateSaveInfo(); });
        files.on('autosave', () => { state.dirty = false; updateSaveInfo(); });
        files.on('file-selected', () => updateSaveInfo());
        files.on('publish', event => {
            state.lastPublish = event;
            updatePublishInfo();
            renderPublishLink();
            toast('Опубликовано: ' + (event.rawUrl || event.url || ''));
            // Единый лог публикаций: дата/время, вид задания, название, ссылка
            appendPublishLog({
                at: new Date().toISOString(),
                type: adapter.label,
                title: (els.pubDescription.value || '').trim() || adapter.title(state.editor.getModel()),
                url: event.taskUrl || '',
            });
        });
        files.on('publish-reset', () => {
            state.lastPublish = null;
            updatePublishInfo();
            renderPublishLink();
        });
        files.on('error', event => toast(event.error ? event.error.message : 'Ошибка файла', true));

        state.filesCache[typeId] = files;
        return files;
    }

    function applyTokens(files) {
        if (!files) return;
        files.setToken('github', state.settings.gh || '');
        files.setToken('gitverse', state.settings.gv || '');
        files.setToken('server', state.settings.server || '');
    }

    function updateSaveInfo() {
        if (!state.files) return;
        const at = state.files.getLastSaveTime();
        els.statusSave.textContent = at
            ? 'Файл: ' + (state.files.getFileName() || '—') + ' · ' + new Date(at).toLocaleTimeString()
            : 'Файл: ' + (state.files.getFileName() || 'не выбран');
        els.autosaveToggle.checked = state.files.isAutosaveEnabled();
    }

    function updatePublishInfo() {
        const last = state.files ? state.files.getLastPublish() : null;
        state.lastPublish = last;
        let stale = false;
        try { stale = !!(state.files && state.files.isPublishedStale && state.files.isPublishedStale()); } catch (e) { stale = false; }
        els.statusPublish.textContent = !last
            ? 'Не опубликовано'
            : (stale
                ? 'Изменено после публикации — нужна повторная публикация'
                : 'Опубликовано: ' + (last.target || '') + ' · ' + new Date(last.at).toLocaleTimeString());
    }

    /* ------------------------------- Промпты ------------------------------- */

    function promptsFor(typeId) {
        if (state.promptsCache[typeId]) return state.promptsCache[typeId];
        const adapter = window.MtV3Types.get(typeId);
        const prompts = PromptsApi.create({
            type: typeId,                    // 'rt' | 'mt' | 'ft' — промпты своего вида теста
            storagePrefix: 'mtV3_prompts_' + typeId,
            tokenProvider: () => state.settings.gh || '',
            dialogTitle: 'Режим работы: ' + adapter.label,
        });
        prompts.on('status', event => setStatus(event.message));
        prompts.on('mode-change', updatePromptLabel);
        prompts.on('load', updatePromptLabel);
        prompts.on('save', () => toast('Режимы сохранены в Gist'));
        // Токен, введённый в окне режимов, должен работать и для публикации:
        // переносим его в общие настройки и во все файловые экземпляры.
        prompts.on('token-change', () => {
            const token = prompts.getToken();
            if (token && token !== state.settings.gh) {
                state.settings.gh = token;
                saveSettings();
                Object.keys(state.filesCache).forEach(typeId => applyTokens(state.filesCache[typeId]));
            }
            updatePromptLabel();
        });
        prompts.load().then(updatePromptLabel).catch(e => setStatus('Промпты: ' + e.message, true));
        state.promptsCache[typeId] = prompts;
        return prompts;
    }

    /* --------------------------------- AI --------------------------------- */

    // Извлечение XML задания из ответа модели. Корневой тег ищем без учёта
    // регистра: сначала в код-блоках ``` … ``` (их может быть несколько —
    // берём первый блок с нужным корнем), затем по всему ответу.
    function extractXml(text, root) {
        const content = String(text || '');
        if (!root) return '';
        const openTag = ('<' + root).toLowerCase();
        const closeTag = ('</' + root + '>').toLowerCase();

        const blocks = [];
        const re = /```[^\n]*\n?([\s\S]*?)```/gi;
        let m;
        while ((m = re.exec(content))) blocks.push(m[1]);

        const candidates = blocks.concat([content]);
        for (const block of candidates) {
            const low = block.toLowerCase();
            const start = low.indexOf(openTag);
            if (start === -1) continue;
            const end = low.lastIndexOf(closeTag);
            if (end === -1 || end < start) continue;
            let out = block.slice(start, end + closeTag.length).trim();
            // Корневые теги приводим к каноническому регистру (<ReadingTest> → <readingTest>):
            // out начинается с открывающего тега и заканчивается закрывающим.
            out = '<' + root + out.substring(openTag.length, out.length - closeTag.length) + '</' + root + '>';
            return out;
        }
        return '';
    }

    async function askDeepSeek(overrideXml) {
        if (state.busy) {
            toast('Запрос к DeepSeek уже выполняется — дождитесь ответа или нажмите «Отменить»');
            return;
        }
        const token = (state.settings.ds || '').trim();
        if (!token) {
            openModal('settingsModal');
            toast('Сначала укажите DeepSeek Token в настройках', true);
            return;
        }
        const prompt = state.prompts ? state.prompts.getPromptText() : '';
        if (!prompt.trim()) {
            const active = state.prompts ? state.prompts.getActivePrompt() : null;
            toast('У режима «' + (active ? active.name : '—') + '» пустой промпт — выберите другой в «Режимах» или заполните текст', true);
            return;
        }
        const xml = (typeof overrideXml === 'string' && overrideXml.trim() ? overrideXml : els.xmlEditor.value).trim();
        if (!xml) {
            toast('XML пуст', true);
            return;
        }

        const requestText = prompt + '\n\nXML-ЗАДАНИЕ:\n' + xml;

        dsLastExtracted = '';
        els.dsApplyBtn.hidden = true;
        setBusy(true, 'Отправка запроса в DeepSeek');
        aiController = new AbortController();
        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                signal: aiController.signal,
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    stream: false,
                    messages: [{ role: 'user', content: requestText }],
                }),
            });
            let data = null;
            try { data = await response.json(); } catch (e) { data = null; }
            if (!response.ok) {
                throw new Error((data && (data.error && data.error.message || data.message)) || ('HTTP ' + response.status));
            }
            const reply = data && data.choices && data.choices[0] && data.choices[0].message
                ? data.choices[0].message.content : '';
            if (!reply) throw new Error('пустой ответ модели');
            // Ответ заменяет содержимое XML-окна: одно окно, никаких доп. полей.
            dsLastExtracted = extractXml(reply, state.adapter.rootTag);
            els.xmlEditor.value = reply;
            els.dsApplyBtn.hidden = !dsLastExtracted;
            if (dsLastExtracted) {
                toast('DeepSeek вернул XML — нажмите «Применить к редактору»');
                setStatus('DeepSeek вернул XML — проверьте и примените');
            } else {
                const preview = String(reply).replace(/\s+/g, ' ').trim();
                const short = preview.length > 140 ? preview.slice(0, 140) + '…' : preview;
                toast('В ответе нет <' + state.adapter.rootTag + '> — начало: «' + short +
                    '». Отредактируйте ответ в XML-окне и нажмите ✨ DeepSeek ещё раз', true);
                setStatus('DeepSeek вернул не XML — ответ в XML-окне');
            }
        } catch (e) {
            if (e && e.name === 'AbortError') {
                toast('Запрос к DeepSeek отменён');
                setStatus('DeepSeek: запрос отменён');
            } else {
                toast('DeepSeek: ' + e.message, true);
                setStatus('DeepSeek: ' + e.message, true);
            }
        } finally {
            aiController = null;
            setBusy(false);
        }
    }

    let aiController = null;
    let dsLastExtracted = '';

    // Применить XML из ответа DeepSeek к редактору формы.
    function applyDsExtracted() {
        if (!dsLastExtracted) return;
        els.xmlEditor.value = dsLastExtracted;
        els.dsApplyBtn.hidden = true;
        applyXml();
    }

    let busyTimer = null;
    function setBusy(busy, text) {
        state.busy = busy;
        const overlay = els.busyOverlay;
        overlay.classList.toggle('show', busy);
        if (els.btnAiCancel) els.btnAiCancel.disabled = !busy;
        if (busy) {
            const started = Date.now();
            els.busyText.textContent = text || 'Обработка…';
            els.busyTimer.textContent = '00:00';
            clearInterval(busyTimer);
            busyTimer = setInterval(() => {
                const s = Math.floor((Date.now() - started) / 1000);
                els.busyTimer.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
            }, 1000);
        } else {
            clearInterval(busyTimer);
        }
    }

    /* --------------------------- Подтверждение --------------------------- */

    // Своё окно вместо window.confirm(): браузеры умеют блокировать системные
    // диалоги после нескольких вызовов, и тогда удаление молча не срабатывает.
    let confirmResolve = null;

    function confirmDialog(message, opts) {
        const options = opts || {};
        return new Promise(resolve => {
            if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
            els.confirmTitle.textContent = options.title || 'Подтверждение';
            els.confirmText.textContent = message;
            els.confirmOk.textContent = options.okLabel || 'Удалить';
            els.confirmOk.classList.toggle('btn-danger', !options.neutral);
            confirmResolve = resolve;
            openModal('confirmModal');
            setTimeout(() => { if (els.confirmOk) els.confirmOk.focus(); }, 40);
        });
    }

    function settleConfirm(yes) {
        const resolve = confirmResolve;
        confirmResolve = null;
        closeModal('confirmModal');
        if (resolve) resolve(!!yes);
    }

    /* -------------------------------- Модалки -------------------------------- */

    function openModal(modalId) {
        const modal = id(modalId);
        if (!modal) return;
        modal.classList.add('show');
    }

    function closeModal(modal) {
        if (typeof modal === 'string') modal = id(modal);
        if (modal) modal.classList.remove('show');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal.show').forEach(modal => modal.classList.remove('show'));
    }
    /* ------------------------------ Публикация ------------------------------ */

    /* --------- Единый лог публикаций (Gist + локальный кэш) ---------
       Файл publish_log.json лежит в том же Gist, что и промпты:
       запись — { at, type, title, url } (дата/время, вид задания, название, ссылка).
       Без токена лог ведётся локально и синхронизируется после ввода токена. */
    const PUBLISH_LOG_GIST = '2f9804a3ad5439b1bb60957b8969826a';
    const PUBLISH_LOG_FILE = 'publish_log.json';
    const PUBLISH_LOG_STORAGE = 'mtV3_publishLog';
    const PUBLISH_LOG_LIMIT = 200;
    let publishLogLoading = false;

    function ghToken() {
        return String(state.settings.gh || '').trim();
    }

    async function ghApi(path, options) {
        const headers = Object.assign({ 'Accept': 'application/vnd.github+json' }, (options && options.headers) || {});
        const token = ghToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const resp = await fetch('https://api.github.com' + path, Object.assign({}, options, { headers }));
        if (!resp.ok) throw new Error('GitHub API ' + resp.status);
        return resp.json();
    }

    function readCachedLog() {
        try {
            const list = JSON.parse(localStorage.getItem(PUBLISH_LOG_STORAGE) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function cacheLog(entries) {
        try { localStorage.setItem(PUBLISH_LOG_STORAGE, JSON.stringify(entries)); } catch (e) { /* ignore */ }
    }

    async function fetchPublishLog() {
        const data = await ghApi('/gists/' + PUBLISH_LOG_GIST);
        const file = data.files && data.files[PUBLISH_LOG_FILE];
        if (!file) return null;
        let content = file.content;
        if (typeof content !== 'string' && file.raw_url) {
            const resp = await fetch(file.raw_url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' при чтении лога');
            content = await resp.text();
        }
        const list = JSON.parse(content || '[]');
        return Array.isArray(list) ? list : [];
    }

    async function savePublishLog(entries) {
        cacheLog(entries);
        if (!ghToken()) throw new Error('нет GitHub Token — лог сохранён только в этом браузере');
        await ghApi('/gists/' + PUBLISH_LOG_GIST, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { [PUBLISH_LOG_FILE]: { content: JSON.stringify(entries, null, 2) } } }),
        });
    }

    async function appendPublishLog(entry) {
        if (!entry || !entry.url) return;
        let entries = readCachedLog();
        try {
            const remote = await fetchPublishLog();
            if (remote && remote.length) entries = remote;
        } catch (e) { /* нет сети/токена — пишем из кэша */ }

        entries.unshift(entry);
        const trimmed = entries.slice(0, PUBLISH_LOG_LIMIT);
        try {
            await savePublishLog(trimmed);
        } catch (e) {
            toast('Лог публикаций: ' + e.message, true);
        }
        renderPublishLog(trimmed);
    }

    async function refreshPublishLog() {
        if (publishLogLoading) return;
        publishLogLoading = true;
        renderPublishLog(readCachedLog());
        try {
            const remote = await fetchPublishLog();
            if (remote) {
                cacheLog(remote);
                renderPublishLog(remote);
            }
        } catch (e) {
            els.pubLogList.insertAdjacentHTML('beforeend',
                '<p class="hint">Лог из Gist не загружен (' + escapeHtml(e.message) + ') — показан локальный.</p>');
        } finally {
            publishLogLoading = false;
        }
    }

    function formatLogDate(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    function renderPublishLog(entries) {
        const box = els.pubLogList;
        if (!box) return;
        box.innerHTML = '';

        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'Пока нет опубликованных заданий.';
            box.appendChild(empty);
            return;
        }

        list.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'pub-log-row';

            const info = document.createElement('div');
            info.className = 'pub-log-info';

            const title = document.createElement('div');
            title.className = 'pub-log-title';
            title.textContent = entry.title || 'Без названия';
            info.appendChild(title);

            const meta = document.createElement('div');
            meta.className = 'pub-log-meta';
            meta.textContent = [formatLogDate(entry.at), entry.type].filter(Boolean).join(' · ');
            info.appendChild(meta);

            if (entry.url) {
                const link = document.createElement('a');
                link.className = 'pub-log-link';
                link.href = entry.url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = entry.url;
                info.appendChild(link);
            }

            row.appendChild(info);

            if (entry.url) {
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'btn btn-sm';
                edit.textContent = '✎';
                edit.title = 'Открыть XML этого задания для правки';
                edit.addEventListener('click', () => loadPublishedTask(entry.url));
                row.appendChild(edit);
            }

            box.appendChild(row);
        });
    }

    /**
     * Загрузка XML из опубликованного задания: в ссылке задания лежит
     * параметр ?file=<raw-ссылка на XML> — берём его и читаем сам XML.
     * Возвращает true, если ссылка оказалась ссылкой задания.
     */
    function fileUrlFromTaskLink(ref) {
        try {
            const u = new URL(ref, location.href);
            const value = u.searchParams.get('file') || u.searchParams.get('xml');
            if (!value) return '';
            return new URL(value, u.href).href;
        } catch (e) {
            return '';
        }
    }

    function fileNameFromUrl(url) {
        try {
            const name = new URL(url).pathname.split('/').pop() || '';
            return name || 'task.xml';
        } catch (e) {
            return 'task.xml';
        }
    }

    async function loadXmlFromUrl(url, sourceLabel) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' при загрузке XML');
        const text = await resp.text();
        if (!text.trim()) throw new Error('файл пуст');
        applyLoadedContent(text, fileNameFromUrl(url), sourceLabel);
    }

    async function loadPublishedTask(ref) {
        const fileUrl = fileUrlFromTaskLink(ref);
        if (!fileUrl) {
            toast('В ссылке задания нет параметра ?file=…', true);
            return false;
        }
        try {
            await loadXmlFromUrl(fileUrl, 'задание');
            closeModal('publishModal');
            closeModal('gistModal');
            return true;
        } catch (e) {
            toast('Загрузка задания: ' + e.message, true);
            return false;
        }
    }

    function openPublish() {
        if (!state.adapter) return;
        els.pubDescription.value = state.adapter.title(state.editor.getModel());
        els.pubStatus.textContent = '';
        renderPublishLink();
        refreshPublishLog();
        openModal('publishModal');
    }

    async function runPublish(target) {
        if (!state.files) return;
        const description = els.pubDescription.value.trim() || state.adapter.title(state.editor.getModel());
        els.pubStatus.textContent = 'Публикация…';
        try {
            if (target === 'gist') {
                await state.files.publishToGist({ description, gistFilename: state.adapter.gistFilename });
            } else if (target === 'gitverse') {
                await state.files.publishToGitverse({ fileName: state.adapter.fileBase + '.xml', description });
            } else {
                await state.files.publishToServer({ taskType: state.adapter.serverType, description });
            }
            els.pubStatus.textContent = 'Готово. Ссылка на задание обновлена.';
            state.dirty = false;
            updateSaveInfo();
        } catch (e) {
            els.pubStatus.textContent = 'Ошибка: ' + e.message;
            toast('Публикация: ' + e.message, true);
        }
    }

    function currentFlags() {
        return {
            checkmode: els.flCheck.checked,
            headershow: els.flHeader.checked,
            crushmode: els.flCrush.checked,
            randommode: els.flRandom.checked,
        };
    }

    function renderPublishLink() {
        if (!state.files) return;
        const last = state.files.getLastPublish();

        // Задание изменилось после публикации — ссылка снимается,
        // нужна повторная публикация (старый адрес уже неактуален)
        let stale = false;
        try { stale = typeof state.files.isPublishedStale === 'function' && state.files.isPublishedStale(); }
        catch (e) { stale = false; }

        const url = (last && !stale) ? state.files.getTaskUrl(currentFlags()) : '';
        els.taskUrl.value = url || '';
        els.openTask.href = url || '#';
        els.openTask.classList.toggle('disabled', !url);
        els.btnCopyTask.disabled = !url;
        if (els.pubStale) els.pubStale.hidden = !(last && stale);
    }

    /* ------------------------------ Загрузка ------------------------------ */

    function applyLoadedContent(content, fileName, sourceLabel) {
        let detected = null;
        try { detected = window.MtV3Types.detect(content); } catch (e) { detected = null; }
        if (!detected) {
            toast('Не удалось определить тип XML (ожидались readingTest / quiz / formulas)', true);
            return;
        }
        if (detected.id !== state.typeId) {
            switchType(detected.id, { force: true });
            toast('Открыт файл типа ' + detected.label + ': для автосохранения выберите файл заново');
        }
        try {
            const model = state.adapter.parse(content);
            state.editor.setModel(model);
            state.editor.render();
            rememberMeta(model);
            state.files.setContent(content, { silent: true });
            state.dirty = false;
            state.xmlDirty = false;
            setXml(content, true);
            els.btnApply.disabled = true;
            els.xmlState.textContent = 'загружено';
            updateHeader();
            updateCounts();
            refreshIssues();
            updateSaveInfo();
            if (state.preview.on) { state.preview.index = 0; renderPreview(); }
            setStatus('Загружено: ' + (fileName || sourceLabel || 'XML'));
        } catch (e) {
            toast('Ошибка разбора: ' + e.message, true);
        }
    }

    async function loadFromFile() {
        try {
            const result = await state.files.loadFromFile();
            if (!result) return;
            applyLoadedContent(result.content, result.fileName, 'файл');
        } catch (e) {
            toast('Открытие файла: ' + e.message, true);
        }
    }

    async function loadFromGist() {
        const ref = els.gistRef.value.trim();
        if (!ref) { toast('Вставьте ссылку на задание, Gist или ID', true); return; }

        // 1. Ссылка на опубликованное задание — берём из неё ?file=<XML>
        if (fileUrlFromTaskLink(ref)) {
            await loadPublishedTask(ref);
            return;
        }

        try {
            // 2. Прямая ссылка на XML-файл
            if (/^https?:\/\//i.test(ref) && /\.xml(\?|#|$)/i.test(ref)) {
                await loadXmlFromUrl(ref, 'ссылка');
                closeModal('gistModal');
                return;
            }

            // 3. Gist (страница, raw-ссылка или ID)
            const result = await state.files.loadFromGist(ref);
            closeModal('gistModal');
            applyLoadedContent(result.content, result.fileName, 'Gist');
        } catch (e) {
            toast('Загрузка: ' + e.message, true);
        }
    }

    function newTask() {
        if (state.dirty) {
            confirmDialog('Создать новое задание без сохранения текущего?', { okLabel: 'Создать' })
                .then(ok => { if (ok) newTaskForce(); });
            return;
        }
        newTaskForce();
    }

    function newTaskForce() {
        state.files.resetPublishState();
        const model = applyStoredMeta(state.adapter.blank ? state.adapter.blank() : state.adapter.parse(state.adapter.sample()));
        state.editor.setModel(model);
        state.editor.render();
        state.dirty = false;
        state.xmlDirty = false;
        setXml('', true);
        state.files.setContent('', { silent: true });
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'синхронизировано';
        updateHeader();
        updateCounts();
        refreshIssues();
        updatePublishInfo();
        if (state.preview.on) { state.preview.index = 0; renderPreview(); }
        setStatus('Новое задание: ' + state.adapter.label);
    }

    function loadSample() {
        if (state.dirty) {
            confirmDialog('Заменить текущее задание примером XML?', { okLabel: 'Заменить' })
                .then(ok => { if (ok) loadSampleForce(); });
            return;
        }
        loadSampleForce();
    }

    function loadSampleForce() {
        const model = applyStoredMeta(state.adapter.parse(state.adapter.sample()));
        state.editor.setModel(model);
        state.editor.render();
        const xml = state.adapter.build(state.editor.getModel());
        setXml(xml, true);
        state.files.setContent(xml);
        state.dirty = true;
        state.xmlDirty = false;
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'синхронизировано';
        updateHeader();
        updateCounts();
        refreshIssues();
        if (state.preview.on) { state.preview.index = 0; renderPreview(); }
        setStatus('Загружен пример: ' + state.adapter.label);
    }

    /* ------------------------------ Настройки ------------------------------ */

    function openSettings() {
        els.setGh.value = state.settings.gh || '';
        els.setGv.value = state.settings.gv || '';
        els.setServer.value = state.settings.server || '';
        els.setDs.value = state.settings.ds || '';
        els.setEndpoint.value = state.settings.endpoint || '';
        els.setFolder.value = state.settings.folder || '';
        els.setAutosave.checked = state.settings.autosave !== false;
        openModal('settingsModal');
    }

    function saveSettingsFromModal() {
        const endpointBefore = state.settings.endpoint;
        const folderBefore = state.settings.folder;
        state.settings = {
            gh: els.setGh.value.trim(),
            gv: els.setGv.value.trim(),
            server: els.setServer.value.trim(),
            ds: els.setDs.value.trim(),
            endpoint: els.setEndpoint.value.trim(),
            folder: els.setFolder.value.trim(),
            autosave: els.setAutosave.checked,
        };
        saveSettings();

        Object.keys(state.filesCache).forEach(typeId => {
            applyTokens(state.filesCache[typeId]);
            state.filesCache[typeId].setAutosave(state.settings.autosave);
        });

        if (state.settings.endpoint !== endpointBefore || state.settings.folder !== folderBefore) {
            state.filesCache = {};
            state.files = filesFor(state.typeId);
            state.files.setContent(els.xmlEditor.value, { silent: true });
            updatePublishInfo();
        }

        closeModal('settingsModal');
        updateSaveInfo();
        toast('Настройки сохранены');
    }

    /* -------------------------------- События -------------------------------- */

    function bindToolbar() {
        els.btnNew.addEventListener('click', newTask);
        els.btnOpen.addEventListener('click', loadFromFile);
        els.btnLoadGist.addEventListener('click', () => { els.gistRef.value = ''; openModal('gistModal'); });
        els.btnSave.addEventListener('click', async () => {
            try {
                const result = await state.files.saveToFile({ fileName: state.adapter.fileBase + '.xml' });
                state.dirty = false;
                updateSaveInfo();
                toast('Сохранено: ' + result.fileName);
            } catch (e) {
                toast('Сохранение: ' + e.message, true);
            }
        });
        els.btnCopyXml.addEventListener('click', () => copyText(els.xmlEditor.value));
        els.btnSample.addEventListener('click', loadSample);
        if (els.btnXmlSample) els.btnXmlSample.addEventListener('click', loadSample);
        if (els.btnXmlPaste) {
            els.btnXmlPaste.addEventListener('click', async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    if (!text.trim()) { toast('Буфер обмена пуст', true); return; }
                    els.xmlEditor.value = text;
                    els.xmlEditor.dispatchEvent(new Event('input', { bubbles: true }));
                    syncXmlEmpty();
                    toast('XML вставлен — нажмите «Применить»');
                } catch (e) {
                    toast('Нет доступа к буферу: вставьте вручную (Ctrl+V)', true);
                    els.xmlEditor.focus();
                }
            });
        }
        els.btnApply.addEventListener('click', applyXml);
        els.btnPrompts.addEventListener('click', () => state.prompts.openDialog());
        els.btnAi.addEventListener('click', () => askDeepSeek());
        els.dsApplyBtn.addEventListener('click', applyDsExtracted);
        els.btnAiCancel.addEventListener('click', () => {
            if (aiController) {
                aiController.abort();
                toast('Отменяю запрос…');
            }
        });
        els.btnPreview.addEventListener('click', () => setPreview(!state.preview.on));
        els.pvClose.addEventListener('click', () => setPreview(false));
        els.pvPrev.addEventListener('click', () => previewStep(-1));
        els.pvNext.addEventListener('click', () => previewStep(1));
        els.pvShowAnswers.addEventListener('change', () => {
            state.preview.showAnswers = els.pvShowAnswers.checked;
            renderPreview();
        });
        els.btnPublish.addEventListener('click', openPublish);
        els.btnSettings.addEventListener('click', openSettings);

        els.xmlEditor.addEventListener('focus', () => {
            // Подсказка не должна закрывать поле: по клику сразу прячем её,
            // чтобы можно было печатать или вставлять XML без кнопки «Пример».
            if (els.xmlEmpty) els.xmlEmpty.classList.add('hidden');
        });
        els.xmlEditor.addEventListener('blur', syncXmlEmpty);
        els.xmlEditor.addEventListener('input', () => {
            state.xmlDirty = true;
            state.dirty = true;
            els.btnApply.disabled = false;
            els.xmlState.textContent = 'XML изменён — нажмите «Применить»';
            state.files.setContent(els.xmlEditor.value);
            syncXmlEmpty();
        });
        els.xmlEditor.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                applyXml();
            }
        });

        els.autosaveToggle.addEventListener('change', () => {
            state.settings.autosave = els.autosaveToggle.checked;
            saveSettings();
            Object.keys(state.filesCache).forEach(typeId => state.filesCache[typeId].setAutosave(state.settings.autosave));
            toast(state.settings.autosave ? 'Автосохранение включено' : 'Автосохранение выключено');
        });

        els.typeTabs.addEventListener('click', event => {
            const button = event.target.closest('[data-type]');
            if (button) switchType(button.dataset.type);
        });
    }

    function bindModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', event => {
                if (event.target === modal) {
                    if (modal.id === 'confirmModal') { settleConfirm(false); return; }
                    closeModal(modal);
                }
                const trigger = event.target.closest('[data-close]');
                if (trigger) closeModal(modal);
            });
        });
        document.addEventListener('click', event => {
            const answer = event.target.closest('[data-confirm]');
            if (!answer) return;
            settleConfirm(answer.dataset.confirm === 'yes');
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                const open = document.querySelector('.modal.show');
                if (open) {
                    if (open.id === 'confirmModal') settleConfirm(false); else closeModal(open);
                    return;
                }
                if (state.preview.on) { setPreview(false); return; }
                closeAllModals();
                return;
            }
            const target = event.target;
            const inField = target && typeof target.closest === 'function'
                ? target.closest('input, textarea, select')
                : null;
            if (state.preview.on && !inField) {
                if (event.key === 'ArrowLeft') { event.preventDefault(); previewStep(-1); }
                if (event.key === 'ArrowRight') { event.preventDefault(); previewStep(1); }
            }
        });

        els.btnSaveSettings.addEventListener('click', saveSettingsFromModal);
        els.btnGistLoad.addEventListener('click', loadFromGist);
        els.gistRef.addEventListener('keydown', event => { if (event.key === 'Enter') loadFromGist(); });

        els.pubGist.addEventListener('click', () => runPublish('gist'));
        els.pubGitverse.addEventListener('click', () => runPublish('gitverse'));
        els.pubServer.addEventListener('click', () => runPublish('server'));
        els.btnCopyTask.addEventListener('click', () => copyText(els.taskUrl.value));
        if (els.btnPubLogRefresh) els.btnPubLogRefresh.addEventListener('click', () => refreshPublishLog());
        [els.flCheck, els.flHeader, els.flCrush, els.flRandom].forEach(box => {
            box.addEventListener('change', renderPublishLink);
        });
    }

    function bindResizer() {
        let dragging = false;
        const workspace = document.querySelector('.workspace');
        const resizer = els.resizer;
        resizer.addEventListener('mousedown', () => {
            dragging = true;
            document.body.classList.add('resizing');
        });
        window.addEventListener('mousemove', event => {
            if (!dragging) return;
            const rect = workspace.getBoundingClientRect();
            const left = Math.min(Math.max(360, event.clientX - rect.left), rect.width - 320);
            workspace.style.setProperty('--split', left + 'px');
        });
        window.addEventListener('mouseup', () => {
            dragging = false;
            document.body.classList.remove('resizing');
        });
    }

    function bindUnload() {
        window.addEventListener('beforeunload', event => {
            if (!state.dirty) return undefined;
            event.preventDefault();
            event.returnValue = '';
            return '';
        });
    }

    /* -------------------------------- Старт -------------------------------- */

    function cacheElements() {
        [
            'typeTabs', 'typeEditor', 'editorTitle', 'editorMeta',
            'xmlEditor', 'btnApply', 'xmlState', 'issues', 'xmlEmpty', 'btnXmlSample', 'btnXmlPaste',
            'confirmModal', 'confirmTitle', 'confirmText', 'confirmOk',
            'btnNew', 'btnOpen', 'btnLoadGist', 'btnSave', 'btnCopyXml',
            'btnPrompts', 'btnAi', 'btnPublish', 'btnSettings', 'btnSample',
            'statusText', 'statusCounts', 'statusSave', 'statusPrompt', 'statusPublish',
            'autosaveToggle', 'toast', 'resizer',
            'settingsModal', 'setGh', 'setGv', 'setServer', 'setDs', 'setEndpoint', 'setFolder',
            'setAutosave', 'btnSaveSettings',
            'btnPreview', 'previewPane', 'pvPrev', 'pvNext', 'pvCounter', 'pvLabel', 'pvShowAnswers', 'pvClose', 'pvStage',
            'publishModal', 'pubDescription', 'pubGist', 'pubGitverse', 'pubServer', 'pubStatus',
            'taskUrl', 'btnCopyTask', 'openTask', 'pubStale', 'pubLogList', 'btnPubLogRefresh',
            'flCheck', 'flHeader', 'flCrush', 'flRandom',
            'gistModal', 'gistRef', 'btnGistLoad',
            'busyOverlay', 'busyText', 'busyTimer', 'btnAiCancel',
            'dsApplyBtn',
        ].forEach(name => { els[name] = id(name); });
    }

    document.addEventListener('DOMContentLoaded', () => {
        cacheElements();
        bindToolbar();
        bindModals();
        bindResizer();
        bindUnload();

        const savedType = localStorage.getItem(LS.type);
        const startType = window.MtV3Types.get(savedType) ? savedType : 'rt';
        switchType(startType, { force: true, blank: true });
    });
})();
