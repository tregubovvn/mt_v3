'use strict';

/* =========================================================================
   Единое окно тестирования mt_v3.

   Задание загружается ТОЛЬКО по ссылке: test/index.html?file=<URL>.
   Здесь же — единственное место ввода данных студента: одно поле «ФИО»
   и «Группа». Тип теста определяется по корню XML (readingTest / quiz /
   formulas), после чего открывается соответствующая страница проведения:
   rt/ · mt/ · ft/ — с уже подставленными ФИО, группой и ссылкой на XML.
   ========================================================================= */

(function () {
    const STORAGE_KEY = 'mtV3_test_student';

    const ENGINES = {
        rt: { dir: 'rt', label: 'Reading Test', icon: '📖', root: 'readingTest' },
        mt: { dir: 'mt', label: 'Moodle Quiz', icon: '🎓', root: 'quiz' },
        ft: { dir: 'ft', label: 'Formula Test', icon: '🧮', root: 'formulas' },
    };

    const CORS_PROXY_PREFIXES = [
        'https://api.allorigins.win/raw?url=',
        'https://api.codetabs.com/v1/proxy/?quest=',
    ];
    const YANDEX_API_PREFIX = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=';

    const el = {};
    ['stateLoading', 'stateError', 'stateNoLink', 'stateReady', 'loadUrlText', 'errorText',
        'errorUrl', 'noLinkSample', 'typeBadge', 'taskTopic', 'taskInfo', 'nameForm',
        'fio', 'group', 'nameError', 'btnStart', 'btnRetry'].forEach(id => {
            el[id] = document.getElementById(id);
        });

    const state = {
        fileUrl: '',
        xmlText: '',
        typeId: '',
        booted: false,
    };

    function showState(name) {
        ['stateLoading', 'stateError', 'stateNoLink', 'stateReady'].forEach(id => {
            el[id].hidden = id !== name;
        });
    }

    function errorText(err) {
        const msg = String((err && err.message) || err || '');
        if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) {
            return 'Ссылка недоступна из браузера: сервер не отдал файл или закрыл доступ (CORS). ' +
                'Проверьте, что ссылка открывается в новой вкладке.';
        }
        if (/404/.test(msg)) return 'Файл по ссылке не найден (404).';
        return msg || 'Неизвестная ошибка.';
    }

    async function fetchXml(url) {
        let target = url;

        if (url.includes('yadi.sk') || url.includes('disk.yandex')) {
            const resp = await fetch(YANDEX_API_PREFIX + encodeURIComponent(url));
            if (!resp.ok) throw new Error('Яндекс.Диск: HTTP ' + resp.status);
            const data = await resp.json();
            if (!data.href) throw new Error('Яндекс.Диск: не удалось получить ссылку на скачивание');
            target = data.href;
        }

        let response;
        try {
            response = await fetch(target);
        } catch (e) {
            // прямое обращение заблокировано (CORS) — пробуем прокси
            let lastErr = e;
            for (const prefix of CORS_PROXY_PREFIXES) {
                try {
                    const proxied = await fetch(prefix + encodeURIComponent(target));
                    if (proxied.ok) { response = proxied; lastErr = null; break; }
                } catch (err) { lastErr = err; }
            }
            if (!response) throw lastErr || e;
        }

        if (!response.ok) throw new Error('HTTP ' + response.status + ' при загрузке задания');
        const text = await response.text();
        if (!text.trim()) throw new Error('пустой файл задания');
        return text;
    }

    function detectRoot(xmlText) {
        let root = '';
        try {
            root = window.MtV3Xml.rootName(xmlText);
        } catch (e) {
            root = '';
        }
        if (!root) {
            // запасной путь: первый элемент документа
            const m = xmlText.match(/<\s*([A-Za-z_][\w.-]*)[\s>/]/);
            root = m ? m[1] : '';
        }
        return root;
    }

    function typeByRoot(root) {
        const lower = String(root || '').toLowerCase();
        return Object.keys(ENGINES).find(id => ENGINES[id].root.toLowerCase() === lower) || '';
    }

    function countTask(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc.querySelector('parsererror')) return { topic: '', info: '' };
        const q = doc.querySelectorAll('question').length;
        const f = doc.querySelectorAll('fragment').length;
        const formulas = doc.querySelectorAll('formula').length;
        const topicEl = doc.querySelector('topicName');
        const topic = (topicEl && topicEl.textContent || '').trim();

        let info = '';
        if (state.typeId === 'rt') {
            info = `Фрагментов: ${f} · вопросов: ${q}`;
        } else if (state.typeId === 'mt') {
            info = `Вопросов: ${q}`;
        } else if (state.typeId === 'ft') {
            info = `Формул: ${formulas}`;
        }
        return { topic, info };
    }

    function loadStudent() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved) {
                el.fio.value = saved.fio || '';
                el.group.value = saved.group || '';
            }
        } catch (e) { /* localStorage недоступен — не мешает работе */ }
        // группа по умолчанию, если она ещё ни разу не вводилась
        if (!el.group.value) el.group.value = 'МЕНЖ';
        updateStartState();
    }

    function updateStartState() {
        const ok = el.fio.value.trim().length >= 2;
        el.btnStart.disabled = !ok;
        if (ok) el.nameError.hidden = true;
    }

    async function boot() {
        if (state.booted) return;
        state.booted = true;
        const params = new URLSearchParams(location.search);
        const raw = (params.get('file') || params.get('xml') || '').trim();
        // Ссылка может быть относительной — приводим к абсолютной, чтобы
        // она работала и на страницах движков (rt/ · mt/ · ft/).
        try {
            state.fileUrl = raw ? new URL(raw, location.href).href : '';
        } catch (e) {
            state.fileUrl = raw;
        }

        el.noLinkSample.textContent = location.origin + location.pathname + '?file=https://example.com/task.xml';

        if (!state.fileUrl) {
            showState('stateNoLink');
            return;
        }

        el.loadUrlText.textContent = state.fileUrl;
        showState('stateLoading');

        try {
            state.xmlText = await fetchXml(state.fileUrl);
        } catch (err) {
            el.errorText.textContent = errorText(err);
            el.errorUrl.textContent = state.fileUrl;
            showState('stateError');
            return;
        }

        const root = detectRoot(state.xmlText);
        state.typeId = typeByRoot(root);
        if (!state.typeId) {
            el.errorText.textContent = 'В файле не найден корень задания (ожидались readingTest, quiz или formulas)';
            el.errorUrl.textContent = state.fileUrl;
            showState('stateError');
            return;
        }

        const engine = ENGINES[state.typeId];
        el.typeBadge.textContent = engine.icon + ' ' + engine.label;

        const { topic, info } = countTask(state.xmlText);
        el.taskTopic.textContent = topic || 'Тема не указана';
        el.taskInfo.textContent = info;

        showState('stateReady');
        loadStudent();
        el.fio.focus();
    }

    const ENGINE_FLAGS = ['checkmode', 'headershow', 'crushmode', 'randommode'];

    // Флаги режимов приходят из ссылки на задание (их ставит редактор при
    // публикации) — передаём их дальше в приложение тестирования.
    function readFlags() {
        const params = new URLSearchParams(location.search);
        const out = {};
        ENGINE_FLAGS.forEach(name => {
            for (const [key, value] of params.entries()) {
                if (key.toLowerCase() !== name) continue;
                if (value === '' || ['true', '1', 'yes'].includes(value.toLowerCase())) out[name] = 'true';
            }
        });
        return out;
    }

    function startTest(event) {
        if (event) event.preventDefault();

        const fio = el.fio.value.trim();
        const group = el.group.value.trim();
        if (fio.length < 2) {
            el.nameError.textContent = 'Укажите ФИО (минимум 2 символа)';
            el.nameError.hidden = false;
            el.fio.focus();
            return;
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ fio, group }));
        } catch (e) { /* не критично */ }

        const engine = ENGINES[state.typeId];
        const query = new URLSearchParams({
            file: state.fileUrl,
            fio: fio,
            group: group,
        });
        const flags = readFlags();
        Object.keys(flags).forEach(name => query.set(name, flags[name]));
        location.href = engine.dir + '/index.html?' + query.toString();    }

    el.nameForm.addEventListener('submit', startTest);
    el.fio.addEventListener('input', updateStartState);
    el.btnRetry.addEventListener('click', () => { state.booted = false; boot(); });

    document.addEventListener('DOMContentLoaded', boot);
    if (document.readyState !== 'loading') boot();
})();
