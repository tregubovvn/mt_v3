'use strict';

/* =========================================================================
   Тип XML: Reading Test (RE:AD), корень <readingTest>.
   Свой редактор: тема, фрагменты, вопросы choice/input.
   ========================================================================= */

(function () {
    const X = window.MtV3Xml;
    const esc = X.escapeXml;
    const DEFAULT_EXCELLENT = 60;
    const DEFAULT_GOOD = 90;

    /* ------------------------------- Модель ------------------------------- */

    function blankChoice() {
        return {
            type: 'choice',
            text: '',
            options: [{ text: '', correct: true }, { text: '', correct: false },
                      { text: '', correct: false }, { text: '', correct: false }],
            answer: '',
        };
    }

    function blankInput() {
        return { type: 'input', text: '', options: [], answer: '' };
    }

    function blankFragment() {
        return { timeExcellent: DEFAULT_EXCELLENT, timeGood: DEFAULT_GOOD, text: '', questions: [] };
    }

    function emptyMeta() {
        return { author: '', university: '', discipline: '', audience: '' };
    }

    /* ------------------------------ Пример ------------------------------ */

    function sample() {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<readingTest>',
            '    <topicName>Демонстрационная тема</topicName>',
            '    <fragment timeExcellent="60" timeGood="90">',
            '        <text>Внимание — это способность удерживать в сознании объект, который не связан с текущими впечатлениями. Оно позволяет человеку сохранять направленность деятельности и замечать детали, важные для решения задачи.</text>',
            '        <questions>',
            '            <question type="choice">',
            '                <text>Что, по тексту, позволяет удерживать внимание?</text>',
            '                <options>',
            '                    <option correct="true">Объект, не связанный с текущими впечатлениями</option>',
            '                    <option>Любой внешний раздражитель</option>',
            '                    <option>Только сильные эмоции</option>',
            '                    <option>Автоматические действия</option>',
            '                </options>',
            '            </question>',
            '            <question type="input">',
            '                <text>Напишите термин (1 слово): способность удерживать объект в сознании — это …</text>',
            '                <answer>внимание</answer>',
            '            </question>',
            '        </questions>',
            '    </fragment>',
            '</readingTest>',
        ].join('\n');
    }

    /* -------------------------------- Разбор -------------------------------- */

    function parse(xml) {
        const root = X.parseXml(xml);
        if (root.name !== 'readingTest') throw new Error('ожидался корень <readingTest>');

        const model = {
            topicName: X.textOf(root, 'topicName'),
            meta: {
                author: X.textOf(root, 'author'),
                university: X.textOf(root, 'university'),
                discipline: X.textOf(root, 'discipline'),
                audience: X.textOf(root, 'targetAudience'),
            },
            fragments: [],
        };

        X.children(root, 'fragment').forEach(frag => {
            const questionsNode = X.child(frag, 'questions');
            const questions = X.children(questionsNode, 'question').map(q => {
                const type = X.attr(q, 'type', 'choice') === 'input' ? 'input' : 'choice';
                const text = X.textOf(q, 'text');
                if (type === 'input') {
                    return { type, text, options: [], answer: X.textOf(q, 'answer') };
                }
                const options = X.children(X.child(q, 'options'), 'option').map(opt => ({
                    text: String(opt.text || ''),
                    correct: X.attr(opt, 'correct') === 'true',
                }));
                return {
                    type,
                    text,
                    options: options.length ? options : blankChoice().options,
                    answer: '',
                };
            });
            model.fragments.push({
                timeExcellent: X.intAttr(frag, 'timeExcellent', DEFAULT_EXCELLENT),
                timeGood: X.intAttr(frag, 'timeGood', DEFAULT_GOOD),
                text: X.textOf(frag, 'text'),
                questions,
            });
        });

        if (!model.fragments.length) throw new Error('в файле нет ни одного <fragment>');
        return model;
    }

    /* -------------------------------- Сборка -------------------------------- */

    function build(model) {
        const meta = model.meta || emptyMeta();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<readingTest>\n';
        xml += '    <topicName>' + esc(model.topicName || '') + '</topicName>\n';
        if (meta.author) xml += '    <author>' + esc(meta.author) + '</author>\n';
        if (meta.university) xml += '    <university>' + esc(meta.university) + '</university>\n';
        if (meta.discipline) xml += '    <discipline>' + esc(meta.discipline) + '</discipline>\n';
        if (meta.audience) xml += '    <targetAudience>' + esc(meta.audience) + '</targetAudience>\n';

        (model.fragments || []).forEach(frag => {
            xml += '    <fragment timeExcellent="' + (frag.timeExcellent || DEFAULT_EXCELLENT) +
                '" timeGood="' + (frag.timeGood || DEFAULT_GOOD) + '">\n';
            xml += '        <text>' + esc(frag.text || '') + '</text>\n';
            xml += '        <questions>\n';
            (frag.questions || []).forEach(q => {
                xml += '            <question type="' + (q.type === 'input' ? 'input' : 'choice') + '">\n';
                xml += '                <text>' + esc(q.text || '') + '</text>\n';
                if (q.type === 'input') {
                    xml += '                <answer>' + esc(q.answer || '') + '</answer>\n';
                } else {
                    xml += '                <options>\n';
                    (q.options || []).forEach(opt => {
                        xml += '                    <option' + (opt.correct ? ' correct="true"' : '') + '>' +
                            esc(opt.text || '') + '</option>\n';
                    });
                    xml += '                </options>\n';
                }
                xml += '            </question>\n';
            });
            xml += '        </questions>\n';
            xml += '    </fragment>\n';
        });
        xml += '</readingTest>';
        return xml;
    }

    /* ------------------------------ Метаданные ------------------------------ */

    function title(model) {
        return (model && model.topicName) || 'Reading Test';
    }

    function stats(model) {
        const fragments = (model && model.fragments) || [];
        const questions = fragments.reduce((sum, f) => sum + (f.questions || []).length, 0);
        return 'Фрагментов: ' + fragments.length + ' · вопросов: ' + questions;
    }

    function validate(model) {
        const issues = [];
        const fragments = (model && model.fragments) || [];
        if (!(model.topicName || '').trim()) issues.push({ level: 'warn', text: 'Не задано название темы (topicName)' });
        if (!fragments.length) issues.push({ level: 'error', text: 'Нет ни одного фрагмента' });

        fragments.forEach((frag, fi) => {
            const label = 'Фрагмент ' + (fi + 1);
            const words = (frag.text || '').trim().split(/\s+/).filter(Boolean).length;
            if (!words) issues.push({ level: 'error', text: label + ': пустой текст' });
            else if (words < 40) issues.push({ level: 'warn', text: label + ': короткий текст (' + words + ' слов)' });

            (frag.questions || []).forEach((q, qi) => {
                const qLabel = label + ', вопрос ' + (qi + 1);
                if (!(q.text || '').trim()) issues.push({ level: 'warn', text: qLabel + ': пустая формулировка' });
                if (q.type === 'input') {
                    if (!(q.answer || '').trim()) issues.push({ level: 'error', text: qLabel + ': не задан ответ' });
                    return;
                }
                const options = q.options || [];
                if (options.length !== 4) issues.push({ level: 'warn', text: qLabel + ': вариантов ' + options.length + ' вместо 4' });
                const correct = options.filter(o => o.correct).length;
                if (correct !== 1) issues.push({ level: 'error', text: qLabel + ': правильных вариантов ' + correct + ' (нужен 1)' });
                if (options.some(o => !(o.text || '').trim())) issues.push({ level: 'warn', text: qLabel + ': есть пустые варианты' });
            });
        });

        return issues;
    }

    /* ------------------------------- Редактор ------------------------------- */

    function createEditor(container, ctx) {
        let model = { topicName: '', meta: emptyMeta(), fragments: [blankFragment()] };
        let current = 0;

        container.innerHTML = [
            '<div class="ed-top">',
            '  <label class="field grow"><span class="label">Тема (topicName)</span>',
            '    <input class="input" data-rt="topic" placeholder="Название темы"></label>',
            '  <details class="meta-box"><summary>Метаданные</summary>',
            '    <div class="grid2">',
            '      <label class="field"><span class="label">Автор</span><input class="input" data-meta="author"></label>',
            '      <label class="field"><span class="label">Университет</span><input class="input" data-meta="university"></label>',
            '      <label class="field"><span class="label">Дисциплина</span><input class="input" data-meta="discipline"></label>',
            '      <label class="field"><span class="label">Аудитория</span><input class="input" data-meta="audience"></label>',
            '    </div>',
            '  </details>',
            '</div>',
            '<div class="tabs" data-rt="tabs"></div>',
            '<div class="ed-toolbar">',
            '  <button type="button" class="btn btn-sm" data-act="add-fragment">＋ Фрагмент</button>',
            '  <button type="button" class="btn btn-sm btn-danger" data-act="del-fragment">Удалить фрагмент</button>',
            '  <span class="hint" data-rt="frag-info"></span>',
            '</div>',
            '<div class="ed-body" data-rt="body"></div>',
        ].join('');

        const els = {
            topic: container.querySelector('[data-rt="topic"]'),
            tabs: container.querySelector('[data-rt="tabs"]'),
            body: container.querySelector('[data-rt="body"]'),
            fragInfo: container.querySelector('[data-rt="frag-info"]'),
            meta: Array.from(container.querySelectorAll('[data-meta]')),
        };

        function frag() { return model.fragments[current]; }
        function words(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }

        function render() {
            if (!model.fragments.length) model.fragments.push(blankFragment());
            if (current >= model.fragments.length) current = model.fragments.length - 1;
            if (current < 0) current = 0;

            if (document.activeElement !== els.topic) els.topic.value = model.topicName || '';
            els.meta.forEach(input => {
                if (document.activeElement !== input) input.value = (model.meta || emptyMeta())[input.dataset.meta] || '';
            });

            els.tabs.innerHTML = model.fragments.map((f, i) => {
                const bad = !(f.text || '').trim() || (f.questions || []).some(q =>
                    (q.type === 'choice' && (q.options || []).filter(o => o.correct).length !== 1) ||
                    (q.type === 'input' && !(q.answer || '').trim()));
                return '<button type="button" class="tab' + (i === current ? ' active' : '') + (bad ? ' warn' : '') +
                    '" data-nav="' + i + '">Фрагмент ' + (i + 1) + '</button>';
            }).join('');

            const f = frag();
            els.fragInfo.textContent = 'Слов: ' + words(f.text) + ' · вопросов: ' + (f.questions || []).length;
            els.body.innerHTML = [
                '<div class="grid3">',
                '  <label class="field"><span class="label">Время «отлично», с</span>',
                '    <input type="number" min="10" step="5" class="input" data-f="timeExcellent" value="' + (f.timeExcellent || DEFAULT_EXCELLENT) + '"></label>',
                '  <label class="field"><span class="label">Время «хорошо», с</span>',
                '    <input type="number" min="10" step="5" class="input" data-f="timeGood" value="' + (f.timeGood || DEFAULT_GOOD) + '"></label>',
                '</div>',
                '<label class="field"><span class="label">Текст фрагмента</span>',
                '  <textarea class="textarea" rows="7" data-f="text" placeholder="Абзац учебного текста">' + esc(f.text || '') + '</textarea></label>',
                '<div class="q-list">',
                (f.questions || []).map((q, qi) => questionHtml(q, qi)).join(''),
                '</div>',
                '<div class="ed-toolbar">',
                '  <button type="button" class="btn btn-sm" data-act="add-choice">＋ choice</button>',
                '  <button type="button" class="btn btn-sm" data-act="add-input">＋ input</button>',
                '</div>',
            ].join('');
        }

        function questionHtml(q, qi) {
            const isChoice = q.type !== 'input';
            return [
                '<div class="qcard" data-q="' + qi + '">',
                '  <div class="qhead">',
                '    <span class="badge">' + (isChoice ? 'choice' : 'input') + '</span>',
                '    <select class="select select-sm" data-qf="type">',
                '      <option value="choice"' + (isChoice ? ' selected' : '') + '>choice</option>',
                '      <option value="input"' + (!isChoice ? ' selected' : '') + '>input</option>',
                '    </select>',
                '    <button type="button" class="icon-btn" data-act="del-question" title="Удалить вопрос">✕</button>',
                '  </div>',
                '  <textarea class="textarea" rows="2" data-qf="text" placeholder="Формулировка вопроса">' + esc(q.text || '') + '</textarea>',
                isChoice ? [
                    '<div class="options">',
                    (q.options || []).map((opt, oi) => [
                        '<label class="opt">',
                        '  <input type="radio" name="rt-correct-' + qi + '" data-of="correct"' + (opt.correct ? ' checked' : '') + '>',
                        '  <input class="input" data-of="text" value="' + esc(opt.text || '') + '" placeholder="Вариант ответа">',
                        '  <button type="button" class="icon-btn" data-act="del-option" data-opt="' + oi + '" title="Удалить вариант">✕</button>',
                        '</label>',
                    ].join('')).join(''),
                    '</div>',
                    '<button type="button" class="btn btn-sm btn-ghost" data-act="add-option">＋ вариант</button>',
                ].join('') : [
                    '<label class="field"><span class="label">Эталонный ответ</span>',
                    '  <input class="input" data-qf="answer" value="' + esc(q.answer || '') + '" placeholder="ответ"></label>',
                ].join(''),
                '</div>',
            ].join('\n');
        }

        function questionOf(el) {
            const card = el.closest('[data-q]');
            if (!card) return null;
            return frag().questions[+card.dataset.q] || null;
        }

        container.addEventListener('input', event => {
            const t = event.target;
            if (t.matches('[data-rt="topic"]')) { model.topicName = t.value; ctx.changed(); return; }
            if (t.matches('[data-meta]')) {
                model.meta = model.meta || emptyMeta();
                model.meta[t.dataset.meta] = t.value;
                ctx.changed();
                return;
            }
            if (t.matches('[data-f]')) {
                const f = frag();
                f[t.dataset.f] = t.type === 'number' ? (parseInt(t.value, 10) || 0) : t.value;
                if (t.dataset.f === 'text') {
                    els.fragInfo.textContent = 'Слов: ' + words(t.value) + ' · вопросов: ' + (f.questions || []).length;
                }
                ctx.changed();
                return;
            }
            if (t.matches('[data-qf]')) {
                const q = questionOf(t);
                if (!q) return;
                if (t.dataset.qf === 'type') return;
                q[t.dataset.qf] = t.value;
                ctx.changed();
                return;
            }
            if (t.matches('[data-of]')) {
                const q = questionOf(t);
                const row = t.closest('[data-opt]');
                if (!q || !row) return;
                const opt = q.options[+row.dataset.opt];
                if (!opt) return;
                if (t.dataset.of === 'correct') {
                    q.options.forEach(o => { o.correct = false; });
                    opt.correct = true;
                } else {
                    opt.text = t.value;
                }
                ctx.changed();
            }
        });

        container.addEventListener('change', event => {
            const t = event.target;
            if (t.matches('[data-qf="type"]')) {
                const q = questionOf(t);
                if (!q) return;
                const next = t.value === 'input' ? 'input' : 'choice';
                if (next !== q.type) {
                    q.type = next;
                    if (next === 'choice' && !(q.options || []).length) q.options = blankChoice().options;
                    if (next === 'input') q.answer = q.answer || '';
                    render();
                    ctx.changed();
                }
                return;
            }
            if (t.matches('[data-of="correct"]')) {
                const q = questionOf(t);
                if (!q) return;
                q.options.forEach(o => { o.correct = false; });
                const row = t.closest('[data-opt]');
                const opt = q.options[+row.dataset.opt];
                if (opt) opt.correct = true;
                ctx.changed();
            }
        });

        container.addEventListener('click', event => {
            const nav = event.target.closest('[data-nav]');
            if (nav) {
                current = +nav.dataset.nav;
                render();
                return;
            }
            const action = event.target.closest('[data-act]');
            if (!action) return;
            const act = action.dataset.act;
            const f = frag();

            if (act === 'add-fragment') {
                model.fragments.push(blankFragment());
                current = model.fragments.length - 1;
                render(); ctx.changed();
            } else if (act === 'del-fragment') {
                if (model.fragments.length <= 1) { ctx.toast('Нельзя удалить последний фрагмент', true); return; }
                if (!confirm('Удалить фрагмент ' + (current + 1) + '?')) return;
                model.fragments.splice(current, 1);
                current = Math.max(0, current - 1);
                render(); ctx.changed();
            } else if (act === 'add-choice' || act === 'add-input') {
                f.questions.push(act === 'add-choice' ? blankChoice() : blankInput());
                render(); ctx.changed();
            } else if (act === 'del-question') {
                const q = questionOf(action);
                const index = f.questions.indexOf(q);
                if (index >= 0 && confirm('Удалить вопрос?')) {
                    f.questions.splice(index, 1);
                    render(); ctx.changed();
                }
            } else if (act === 'add-option') {
                const q = questionOf(action);
                if (q) {
                    q.options.push({ text: '', correct: false });
                    render(); ctx.changed();
                }
            } else if (act === 'del-option') {
                const q = questionOf(action);
                const index = +action.dataset.opt;
                if (q && q.options.length > 2) {
                    const wasCorrect = q.options[index].correct;
                    q.options.splice(index, 1);
                    if (wasCorrect && q.options[0]) q.options[0].correct = true;
                    render(); ctx.changed();
                }
            }
        });

        return {
            render,
            getModel: () => model,
            setModel(next) {
                model = next && next.fragments ? next : { topicName: '', meta: emptyMeta(), fragments: [blankFragment()] };
                if (!model.fragments.length) model.fragments.push(blankFragment());
                current = 0;
            },
        };
    }

    window.MtV3Types.register({
        id: 'rt',
        label: 'Reading Test',
        short: 'RE:AD',
        fileBase: 'reading_test',
        gistFilename: 'reading_test.xml',
        taskApp: { baseUrl: 'https://tregubovvn.github.io/rt_v2/index.html', paramName: 'file' },
        serverType: 'ReadTest',
        promptPreset: 'rt_v2',
        rootTag: 'readingTest',
        matches: root => root === 'readingTest',
        sample, parse, build, title, stats, validate, createEditor,
    });
})();
