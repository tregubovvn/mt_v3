'use strict';

/* =========================================================================
   mt_v3 — единый редактор XML-заданий.

   Один интерфейс и одно ядро (файлы, сохранение, публикация, промпты, AI),
   три разных редактора по типу XML:
     • rt — Reading Test (<readingTest>)   → тестирование в rt_v2
     • mt — Moodle Quiz (<quiz>)           → тестирование в mt_v2
     • ft — Formula Test (<formulas>)      → тестирование в ft

   Файлы и публикация — save_api/file-api.js, режимы — save_api/prompts-api.js.
   ========================================================================= */

(function () {
    const els = {};
    const LS = {
        type: 'mtV3_active_type',
        settings: 'mtV3_settings',
    };
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
        dirty: false,
        xmlDirty: false,
        busy: false,
        flags: { checkmode: false, headershow: false, crushmode: false, randommode: false },
        lastPublish: null,
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
            if (state.dirty && !confirm('В текущем задании есть изменения. Переключить тип без сохранения?')) return;
        }

        state.typeId = typeId;
        state.adapter = adapter;
        state.files = filesFor(typeId);
        state.prompts = promptsFor(typeId);

        const model = adapter.parse(adapter.sample());
        els.typeEditor.innerHTML = '';
        state.editor = adapter.createEditor(els.typeEditor, {
            changed: onModelChanged,
            toast: toast,
        });
        state.editor.setModel(model);
        state.editor.render();

        state.dirty = false;
        state.xmlDirty = false;
        state.lastPublish = state.files.getLastPublish();
        setXml(adapter.build(state.editor.getModel()), true);
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
        if (!state.adapter) return;
        els.editorTitle.textContent = state.adapter.label;
        els.editorMeta.textContent = state.adapter.stats(state.editor.getModel());
    }

    function updateCounts() {
        if (!state.adapter || !state.editor) return;
        els.statusCounts.textContent = state.adapter.stats(state.editor.getModel());
    }

    function updatePromptLabel() {
        const prompt = state.prompts && state.prompts.getActivePrompt();
        els.statusPrompt.textContent = 'Режим: ' + (prompt ? prompt.name : '—');
    }

    /* ------------------------------- XML-панель ------------------------------- */

    function setXml(text, force) {
        if (!force && document.activeElement === els.xmlEditor) return;
        els.xmlEditor.value = text;
    }

    function onModelChanged() {
        if (!state.adapter || !state.editor) return;
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
        state.files.setContent(text);
        state.dirty = true;
        state.xmlDirty = false;
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'применено';
        updateHeader();
        updateCounts();
        refreshIssues();
        toast('XML применён к редактору');
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

    function filesFor(typeId) {
        if (state.filesCache[typeId]) return state.filesCache[typeId];
        const adapter = window.MtV3Types.get(typeId);
        const options = {
            gistFilename: adapter.gistFilename,
            fileName: adapter.fileBase + '.xml',
            storagePrefix: 'mtV3_' + typeId,
            taskApp: adapter.taskApp,
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
        files.on('save', () => { state.dirty = false; updateSaveInfo(); });
        files.on('autosave', () => { state.dirty = false; updateSaveInfo(); });
        files.on('file-selected', () => updateSaveInfo());
        files.on('publish', event => {
            state.lastPublish = event;
            updatePublishInfo();
            renderPublishLink();
            toast('Опубликовано: ' + (event.rawUrl || event.url || ''));
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
        els.statusPublish.textContent = last
            ? 'Опубликовано: ' + (last.target || '') + ' · ' + new Date(last.at).toLocaleTimeString()
            : 'Не опубликовано';
    }

    /* ------------------------------- Промпты ------------------------------- */

    function promptsFor(typeId) {
        if (state.promptsCache[typeId]) return state.promptsCache[typeId];
        const adapter = window.MtV3Types.get(typeId);
        const prompts = PromptsApi.create({
            preset: adapter.promptPreset || null,
            builtins: adapter.promptBuiltins || [],
            storagePrefix: 'mtV3_prompts_' + typeId,
            tokenProvider: () => state.settings.gh || '',
            includeBuiltinsInGist: false,
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

    function extractXml(text) {
        if (!state.adapter) return '';
        const root = state.adapter.rootTag;
        let content = String(text || '');
        const fenced = content.match(/```(?:xml)?\s*([\s\S]*?)```/i);
        if (fenced) content = fenced[1];
        const start = content.indexOf('<' + root);
        const end = content.lastIndexOf('</' + root + '>');
        if (start !== -1 && end !== -1) return content.slice(start, end + root.length + 3).trim();
        return '';
    }

    async function askDeepSeek() {
        if (state.busy) return;
        const token = (state.settings.ds || '').trim();
        if (!token) {
            openModal('settingsModal');
            toast('Сначала укажите DeepSeek Token в настройках', true);
            return;
        }
        const prompt = state.prompts ? state.prompts.getPromptText() : '';
        if (!prompt.trim()) {
            toast('У активного режима нет промпта', true);
            return;
        }
        const xml = els.xmlEditor.value.trim();
        if (!xml) {
            toast('XML пуст', true);
            return;
        }

        setBusy(true, 'DeepSeek: отправка запроса');
        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    stream: false,
                    messages: [{ role: 'user', content: prompt + '\n\nXML-ЗАДАНИЕ:\n' + xml }],
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
            const extracted = extractXml(reply);
            if (!extracted) throw new Error('в ответе нет <' + state.adapter.rootTag + '>');
            els.xmlEditor.value = extracted;
            setStatus('Ответ DeepSeek применён');
            applyXml();
        } catch (e) {
            toast('DeepSeek: ' + e.message, true);
            setStatus('DeepSeek: ' + e.message, true);
        } finally {
            setBusy(false);
        }
    }

    let busyTimer = null;
    function setBusy(busy, text) {
        state.busy = busy;
        const overlay = els.busyOverlay;
        overlay.classList.toggle('show', busy);
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

    function openPublish() {
        if (!state.adapter) return;
        els.pubDescription.value = state.adapter.title(state.editor.getModel());
        els.pubStatus.textContent = '';
        renderPublishLink();
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
        const url = last ? state.files.getTaskUrl(currentFlags()) : '';
        els.taskUrl.value = url || '';
        els.openTask.href = url || '#';
        els.openTask.classList.toggle('disabled', !url);
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
        if (!ref) { toast('Вставьте ссылку на Gist или ID', true); return; }
        try {
            const result = await state.files.loadFromGist(ref);
            closeModal('gistModal');
            applyLoadedContent(result.content, result.fileName, 'Gist');
        } catch (e) {
            toast('Загрузка из Gist: ' + e.message, true);
        }
    }

    function newTask() {
        if (state.dirty && !confirm('Создать новое задание без сохранения текущего?')) return;
        state.files.resetPublishState();
        const model = state.adapter.parse(state.adapter.sample());
        state.editor.setModel(model);
        state.editor.render();
        state.dirty = false;
        state.xmlDirty = false;
        setXml(state.adapter.build(model), true);
        state.files.setContent(els.xmlEditor.value, { silent: true });
        els.btnApply.disabled = true;
        els.xmlState.textContent = 'синхронизировано';
        updateHeader();
        updateCounts();
        refreshIssues();
        updatePublishInfo();
        setStatus('Новое задание: ' + state.adapter.label);
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
        els.btnApply.addEventListener('click', applyXml);
        els.btnPrompts.addEventListener('click', () => state.prompts.openDialog());
        els.btnAi.addEventListener('click', askDeepSeek);
        els.btnPublish.addEventListener('click', openPublish);
        els.btnSettings.addEventListener('click', openSettings);

        els.xmlEditor.addEventListener('input', () => {
            state.xmlDirty = true;
            state.dirty = true;
            els.btnApply.disabled = false;
            els.xmlState.textContent = 'XML изменён — нажмите «Применить»';
            state.files.setContent(els.xmlEditor.value);
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
                if (event.target === modal) closeModal(modal);
                const trigger = event.target.closest('[data-close]');
                if (trigger) closeModal(modal);
            });
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeAllModals();
        });

        els.btnSaveSettings.addEventListener('click', saveSettingsFromModal);
        els.btnGistLoad.addEventListener('click', loadFromGist);
        els.gistRef.addEventListener('keydown', event => { if (event.key === 'Enter') loadFromGist(); });

        els.pubGist.addEventListener('click', () => runPublish('gist'));
        els.pubGitverse.addEventListener('click', () => runPublish('gitverse'));
        els.pubServer.addEventListener('click', () => runPublish('server'));
        els.btnCopyTask.addEventListener('click', () => copyText(els.taskUrl.value));
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
            'xmlEditor', 'btnApply', 'xmlState', 'issues',
            'btnNew', 'btnOpen', 'btnLoadGist', 'btnSave', 'btnCopyXml',
            'btnPrompts', 'btnAi', 'btnPublish', 'btnSettings',
            'statusText', 'statusCounts', 'statusSave', 'statusPrompt', 'statusPublish',
            'autosaveToggle', 'toast', 'resizer',
            'settingsModal', 'setGh', 'setGv', 'setServer', 'setDs', 'setEndpoint', 'setFolder',
            'setAutosave', 'btnSaveSettings',
            'publishModal', 'pubDescription', 'pubGist', 'pubGitverse', 'pubServer', 'pubStatus',
            'taskUrl', 'btnCopyTask', 'openTask',
            'flCheck', 'flHeader', 'flCrush', 'flRandom',
            'gistModal', 'gistRef', 'btnGistLoad',
            'busyOverlay', 'busyText', 'busyTimer',
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
        switchType(startType, { force: true });
    });
})();
