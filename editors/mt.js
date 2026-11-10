'use strict';

/* =========================================================================
   Тип XML: Moodle Quiz, корень <quiz>.
   Свой редактор: вопросы multichoice / truefalse / shortanswer / numerical /
   description. Служебные <question type="category"> пропускаются.
   ========================================================================= */

(function () {
    const X = window.MtV3Xml;
    const esc = X.escapeXml;
    const SUPPORTED = ['multichoice', 'truefalse', 'shortanswer', 'numerical', 'description'];
    const TYPE_LABEL = {
        multichoice: 'Multichoice',
        truefalse: 'True/False',
        shortanswer: 'Short Answer',
        numerical: 'Numerical',
        description: 'Description',
    };

    /* ------------------------------- Модель ------------------------------- */

    function blankAnswer(correct) {
        return { text: '', correct: !!correct, fraction: correct ? 100 : 0, tolerance: 0 };
    }

    function blankQuestion(type) {
        const q = {
            type: type || 'multichoice',
            name: 'Новый вопрос',
            text: '',
            single: true,
            shuffleanswers: true,
            answernumbering: 'abc',
            answers: [],
        };
        if (q.type === 'multichoice') q.answers = [blankAnswer(true), blankAnswer(false), blankAnswer(false), blankAnswer(false)];
        if (q.type === 'truefalse') q.answers = [
            { text: 'Верно', correct: true, fraction: 100, tolerance: 0 },
            { text: 'Неверно', correct: false, fraction: 0, tolerance: 0 },
        ];
        if (q.type === 'shortanswer') q.answers = [blankAnswer(true)];
        if (q.type === 'numerical') q.answers = [blankAnswer(true)];
        return q;
    }

    /* ------------------------------ Пример ------------------------------ */

    function sample() {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<quiz>',
            '    <question type="multichoice">',
            '        <name><text>Пример: вопрос с формулой</text></name>',
            '        <questiontext format="html">',
            '            <text><![CDATA[<p>Выберите правильную формулу: \\\\( \\\\alpha_{н} = \\\\frac{АД_{сэ}}{АД_{с}} \\\\)</p>]]></text>',
            '        </questiontext>',
            '        <answer fraction="100" format="html">',
            '            <text><![CDATA[\\\\( \\\\alpha_{н} = \\\\frac{АД_{сэ}}{АД_{с}} \\\\)]]></text>',
            '        </answer>',
            '        <answer fraction="0" format="html">',
            '            <text><![CDATA[\\\\( \\\\alpha_{н} = \\\\frac{АД_{с}}{АД_{сэ}} \\\\)]]></text>',
            '        </answer>',
            '        <answer fraction="0" format="html">',
            '            <text><![CDATA[\\\\( \\\\alpha_{н} = АД_{сэ} + АД_{с} \\\\)]]></text>',
            '        </answer>',
            '    </question>',
            '    <question type="shortanswer">',
            '        <name><text>Термин</text></name>',
            '        <questiontext format="html"><text><![CDATA[<p>Как называется коэффициент?</p>]]></text></questiontext>',
            '        <answer fraction="100" format="plain"><text>альфа</text></answer>',
            '    </question>',
            '</quiz>',
        ].join('\n');
    }

    /* -------------------------------- Разбор -------------------------------- */

    function textOfWrapper(node, wrapper) {
        return X.textOf(X.child(node, wrapper), 'text');
    }

    function parse(xml) {
        const root = X.parseXml(xml);
        if (root.name !== 'quiz') throw new Error('ожидался корень <quiz>');

        const questions = [];
        X.findAll(root, 'question').forEach(node => {
            const type = X.attr(node, 'type');
            if (type === 'category') return;                 // служебный контейнер Moodle
            if (!SUPPORTED.includes(type)) return;

            const q = {
                type,
                name: textOfWrapper(node, 'name'),
                text: type === 'description' ? textOfWrapper(node, 'description') : textOfWrapper(node, 'questiontext'),
                single: (X.textOf(node, 'single') || 'true') !== 'false',
                shuffleanswers: (X.textOf(node, 'shuffleanswers') || 'true') !== 'false',
                answernumbering: X.textOf(node, 'answernumbering') || 'abc',
                answers: [],
            };

            if (type === 'description') {
                questions.push(q);
                return;
            }

            if (type === 'truefalse') {
                const answers = [
                    { text: 'Верно', correct: false, fraction: 0, tolerance: 0 },
                    { text: 'Неверно', correct: false, fraction: 0, tolerance: 0 },
                ];
                X.children(node, 'answer').forEach(ans => {
                    const raw = X.textOf(ans, 'text').trim().toLowerCase();
                    const fraction = parseFloat(X.attr(ans, 'fraction', '0')) || 0;
                    const index = ['true', 'верно', 'да', 'истина'].includes(raw) ? 0 : 1;
                    answers[index].correct = fraction > 0;
                    answers[index].fraction = fraction > 0 ? 100 : 0;
                });
                q.answers = answers;
                questions.push(q);
                return;
            }

            X.children(node, 'answer').forEach(ans => {
                const fraction = parseFloat(X.attr(ans, 'fraction', '0')) || 0;
                const answer = {
                    text: X.textOf(ans, 'text'),
                    correct: fraction > 0,
                    fraction: Number.isFinite(fraction) ? fraction : 0,
                    tolerance: type === 'numerical' ? (parseFloat(X.textOf(ans, 'tolerance')) || 0) : 0,
                };
                q.answers.push(answer);
            });

            if (!q.answers.length) q.answers = [blankAnswer(type !== 'shortanswer')];
            if (type === 'multichoice' && q.single) {
                let seen = false;
                q.answers.forEach(a => {
                    if (a.correct) {
                        if (seen) a.correct = false; else seen = true;
                    }
                });
            }
            questions.push(q);
        });

        if (!questions.length) {
            throw new Error('нет поддерживаемых вопросов (multichoice / truefalse / shortanswer / numerical / description)');
        }
        return { questions };
    }

    /* -------------------------------- Сборка -------------------------------- */

    function questionXml(q) {
        const head = [
            '    <question type="' + q.type + '">',
            '        <name>',
            '            <text>' + esc(q.name || '') + '</text>',
            '        </name>',
            '        <questiontext format="html">',
            '            <text>' + X.cdata(q.text || '') + '</text>',
            '        </questiontext>',
            '        <generalfeedback format="html">',
            '            <text></text>',
            '        </generalfeedback>',
            '        <defaultgrade>1.0</defaultgrade>',
            '        <penalty>0.3333333</penalty>',
            '        <hidden>0</hidden>',
        ].join('\n') + '\n';

        if (q.type === 'description') {
            return head +
                '        <description format="html">\n' +
                '            <text>' + X.cdata(q.text || '') + '</text>\n' +
                '        </description>\n' +
                '    </question>\n';
        }

        let body = '';
        if (q.type === 'multichoice') {
            body += '        <single>' + (q.single ? 'true' : 'false') + '</single>\n';
            body += '        <shuffleanswers>' + (q.shuffleanswers ? 'true' : 'false') + '</shuffleanswers>\n';
            body += '        <answernumbering>' + esc(q.answernumbering || 'abc') + '</answernumbering>\n';
            body += (q.answers || []).map(a => {
                const fraction = Number.isFinite(a.fraction) ? a.fraction : (a.correct ? 100 : 0);
                return '        <answer fraction="' + fraction + '" format="html">\n' +
                    '            <text>' + X.cdata(a.text || '') + '</text>\n' +
                    '        </answer>\n';
            }).join('');
        } else if (q.type === 'truefalse') {
            body += (q.answers || []).map(a =>
                '        <answer fraction="' + (a.correct ? '100' : '0') + '">\n' +
                '            <text>' + (a.text === 'Верно' ? 'true' : 'false') + '</text>\n' +
                '        </answer>\n').join('');
        } else if (q.type === 'numerical') {
            body += (q.answers || []).map(a => {
                const fraction = Number.isFinite(a.fraction) ? a.fraction : (a.correct ? 100 : 0);
                return '        <answer fraction="' + fraction + '" format="moodle_auto_format">\n' +
                    '            <text>' + esc(String(a.text || '').trim()) + '</text>\n' +
                    '            <tolerance>' + (Number.isFinite(a.tolerance) ? a.tolerance : 0) + '</tolerance>\n' +
                    '        </answer>\n';
            }).join('');
        } else {
            body += (q.answers || []).map(a => {
                const fraction = Number.isFinite(a.fraction) ? a.fraction : (a.correct ? 100 : 0);
                return '        <answer fraction="' + fraction + '" format="plain">\n' +
                    '            <text>' + esc(a.text || '') + '</text>\n' +
                    '        </answer>\n';
            }).join('');
        }

        return head + body + '    </question>\n';
    }

    function build(model) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n';
        (model.questions || []).forEach(q => { xml += questionXml(q); });
        xml += '</quiz>';
        return xml;
    }

    /* ------------------------------ Метаданные ------------------------------ */

    function title(model) {
        const first = model && model.questions && model.questions[0];
        return (first && first.name) || 'Moodle Quiz';
    }

    function stats(model) {
        const questions = (model && model.questions) || [];
        const answers = questions.reduce((sum, q) => sum + (q.answers || []).length, 0);
        return 'Вопросов: ' + questions.length + ' · ответов: ' + answers;
    }

    function validate(model) {
        const issues = [];
        const questions = (model && model.questions) || [];
        if (!questions.length) issues.push({ level: 'error', text: 'Нет ни одного вопроса' });

        questions.forEach((q, qi) => {
            const label = 'Вопрос ' + (qi + 1) + ' (' + (TYPE_LABEL[q.type] || q.type) + ')';
            if (!(q.name || '').trim()) issues.push({ level: 'warn', text: label + ': пустое название' });
            if (!(q.text || '').trim()) issues.push({ level: 'warn', text: label + ': пустой текст вопроса' });

            if (q.type === 'multichoice') {
                const answers = q.answers || [];
                if (answers.length < 2) issues.push({ level: 'error', text: label + ': меньше двух вариантов' });
                const correct = answers.filter(a => a.correct).length;
                if (!correct) issues.push({ level: 'error', text: label + ': не отмечен правильный вариант' });
                if (q.single && correct > 1) issues.push({ level: 'error', text: label + ': правильных больше одного при single' });
            } else if (q.type === 'truefalse') {
                if ((q.answers || []).filter(a => a.correct).length !== 1) {
                    issues.push({ level: 'error', text: label + ': выберите «Верно» или «Неверно»' });
                }
            } else if (q.type === 'shortanswer') {
                if (!(q.answers || []).some(a => (a.text || '').trim())) {
                    issues.push({ level: 'error', text: label + ': нет ни одного эталонного ответа' });
                }
            } else if (q.type === 'numerical') {
                if (!(q.answers || []).some(a => String(a.text || '').trim() !== '')) {
                    issues.push({ level: 'error', text: label + ': не задано число' });
                }
            }
        });

        return issues;
    }

    /* ------------------------------- Редактор ------------------------------- */

    function createEditor(container, ctx) {
        let model = { questions: [blankQuestion('multichoice')] };
        let current = 0;

        container.innerHTML = [
            '<div class="tabs" data-mt="tabs"></div>',
            '<div class="ed-toolbar">',
            '  <select class="select select-sm" data-mt="new-type">',
            SUPPORTED.map(type => '<option value="' + type + '">' + TYPE_LABEL[type] + '</option>').join(''),
            '  </select>',
            '  <button type="button" class="btn btn-sm" data-act="add-question">＋ Вопрос</button>',
            '  <button type="button" class="btn btn-sm btn-danger" data-act="del-question">Удалить вопрос</button>',
            '  <span class="hint" data-mt="q-info"></span>',
            '</div>',
            '<div class="ed-body" data-mt="body"></div>',
        ].join('');

        const els = {
            tabs: container.querySelector('[data-mt="tabs"]'),
            body: container.querySelector('[data-mt="body"]'),
            info: container.querySelector('[data-mt="q-info"]'),
            newType: container.querySelector('[data-mt="new-type"]'),
        };

        function q() { return model.questions[current]; }

        // Единая точка установки правильного ответа: radio/checkbox ведут себя
        // по-разному в multichoice (single) и truefalse.
        function setCorrect(item, index, checked) {
            const answer = (item.answers || [])[index];
            if (!answer) return;
            if (item.type === 'truefalse' || (item.type === 'multichoice' && item.single)) {
                item.answers.forEach(a => { a.correct = false; a.fraction = 0; });
                answer.correct = true;
                answer.fraction = 100;
                return;
            }
            answer.correct = !!checked;
            answer.fraction = checked ? 100 : 0;
        }

        function answersHtml(item) {
            if (item.type === 'description') return '';
            if (item.type === 'truefalse') {
                return '<div class="field"><span class="label">Верный ответ</span><div class="radio-row">' +
                    item.answers.map((a, ai) =>
                        '<label class="radio"><input type="radio" name="mt-tf-' + current + '" data-af="correct"' +
                        (a.correct ? ' checked' : '') + ' data-ai="' + ai + '"> ' + esc(a.text) + '</label>').join('') +
                    '</div></div>';
            }
            const showFraction = true;
            const rows = item.answers.map((a, ai) => [
                '<div class="ans-row" data-ai="' + ai + '">',
                item.type === 'multichoice'
                    ? (item.single
                        ? '<input type="radio" name="mt-correct-' + current + '" data-af="correct"' + (a.correct ? ' checked' : '') + '>'
                        : '<input type="checkbox" data-af="correct"' + (a.correct ? ' checked' : '') + '>')
                    : '<span class="ans-mark">' + (ai + 1) + '</span>',
                '  <input class="input" data-af="text" value="' + esc(a.text || '') + '" placeholder="' +
                    (item.type === 'numerical' ? 'Число, напр. 3.14' : 'Ответ') + '">',
                item.type === 'numerical'
                    ? '<input type="number" step="any" class="input input-sm" data-af="tolerance" value="' + (a.tolerance || 0) + '" title="Допуск ±">'
                    : '',
                showFraction
                    ? '<input type="number" class="input input-sm" data-af="fraction" value="' + (Number.isFinite(a.fraction) ? a.fraction : (a.correct ? 100 : 0)) + '" title="Доля балла">'
                    : '',
                '<button type="button" class="icon-btn" data-act="del-answer" data-ai="' + ai + '" title="Удалить">✕</button>',
                '</div>',
            ].join(''));
            return '<div class="field"><span class="label">Ответы' +
                (item.type === 'multichoice' ? (item.single ? ' (один правильный)' : ' (несколько правильных)') : '') +
                '</span><div class="ans-list">' + rows.join('') + '</div>' +
                '<button type="button" class="btn btn-sm btn-ghost" data-act="add-answer">＋ ответ</button></div>';
        }

        function render() {
            if (!model.questions.length) model.questions.push(blankQuestion('multichoice'));
            if (current >= model.questions.length) current = model.questions.length - 1;
            if (current < 0) current = 0;

            els.tabs.innerHTML = model.questions.map((item, i) => {
                const bad = item.type === 'multichoice'
                    ? !(item.answers || []).some(a => a.correct)
                    : item.type === 'shortanswer'
                        ? !(item.answers || []).some(a => (a.text || '').trim())
                        : item.type === 'numerical'
                            ? !(item.answers || []).some(a => String(a.text || '').trim() !== '')
                            : false;
                return '<button type="button" class="tab' + (i === current ? ' active' : '') + (bad ? ' warn' : '') +
                    '" data-nav="' + i + '">' + (i + 1) + '. ' + (TYPE_LABEL[item.type] || item.type) + '</button>';
            }).join('');

            const item = q();
            els.info.textContent = 'Тип: ' + (TYPE_LABEL[item.type] || item.type) + ' · ответов: ' + (item.answers || []).length;
            els.body.innerHTML = [
                '<div class="grid2">',
                '  <label class="field"><span class="label">Название вопроса</span>',
                '    <input class="input" data-qf="name" value="' + esc(item.name || '') + '"></label>',
                '  <label class="field"><span class="label">Тип</span>',
                '    <select class="select" data-qf="type">',
                SUPPORTED.map(type => '<option value="' + type + '"' + (type === item.type ? ' selected' : '') + '>' + TYPE_LABEL[type] + '</option>').join(''),
                '    </select></label>',
                '</div>',
                '<label class="field"><span class="label">Текст вопроса (HTML / LaTeX в \\\\( \\\\) )</span>',
                '  <textarea class="textarea code" rows="5" data-qf="text" placeholder="<p>Формулировка вопроса</p>">' + esc(item.text || '') + '</textarea></label>',
                item.type === 'multichoice' ? [
                    '<div class="grid3">',
                    '  <label class="check"><input type="checkbox" data-qf="single"' + (item.single ? ' checked' : '') + '> Один правильный ответ</label>',
                    '  <label class="check"><input type="checkbox" data-qf="shuffleanswers"' + (item.shuffleanswers ? ' checked' : '') + '> Перемешивать ответы</label>',
                    '  <label class="field"><span class="label">Нумерация</span>',
                    '    <select class="select select-sm" data-qf="answernumbering">',
                    ['abc', 'ABCD', '123', 'none'].map(v => '<option value="' + v + '"' + (v === item.answernumbering ? ' selected' : '') + '>' + v + '</option>').join(''),
                    '    </select></label>',
                    '</div>',
                ].join('') : '',
                answersHtml(item),
            ].join('');
        }

        container.addEventListener('input', event => {
            const t = event.target;
            const item = q();
            if (t.matches('[data-qf]')) {
                const field = t.dataset.qf;
                if (field === 'type') return;
                if (t.type === 'checkbox') item[field] = t.checked;
                else item[field] = t.value;
                if (field === 'text' && item.type === 'description') ctx.changed();
                ctx.changed();
                return;
            }
            if (t.matches('[data-af]')) {
                const row = t.closest('[data-ai]');
                const index = row ? +row.dataset.ai : -1;
                if (index < 0) return;
                const answer = (item.answers || [])[index];
                if (!answer) return;
                if (t.dataset.af === 'correct') {
                    setCorrect(item, index, t.checked);
                } else if (t.dataset.af === 'text') {
                    answer.text = t.value;
                } else if (t.dataset.af === 'fraction') {
                    answer.fraction = parseFloat(t.value) || 0;
                    answer.correct = answer.fraction > 0;
                } else if (t.dataset.af === 'tolerance') {
                    answer.tolerance = parseFloat(t.value) || 0;
                }
                ctx.changed();
            }
        });

        container.addEventListener('change', event => {
            const t = event.target;
            if (t.matches('[data-qf="type"]')) {
                const item = q();
                if (item.type === t.value) return;
                const replacement = blankQuestion(t.value);
                replacement.name = item.name;
                replacement.text = item.text;
                model.questions[current] = replacement;
                render();
                ctx.changed();
                return;
            }
            if (t.matches('[data-af="correct"]')) {
                const row = t.closest('[data-ai]');
                if (!row) return;
                setCorrect(q(), +row.dataset.ai, t.checked);
                ctx.changed();
                return;
            }
            if (t.matches('[data-qf="single"]')) {
                const item = q();
                item.single = t.checked;
                if (item.single) {
                    let seen = false;
                    item.answers.forEach(a => {
                        if (a.correct) {
                            if (seen) { a.correct = false; a.fraction = 0; } else seen = true;
                        }
                    });
                }
                render();
                ctx.changed();
            }
        });

        container.addEventListener('click', event => {
            const nav = event.target.closest('[data-nav]');
            if (nav) { current = +nav.dataset.nav; render(); return; }

            const action = event.target.closest('[data-act]');
            if (!action) return;
            const act = action.dataset.act;
            const item = q();

            if (act === 'add-question') {
                model.questions.push(blankQuestion(els.newType.value));
                current = model.questions.length - 1;
                render(); ctx.changed();
            } else if (act === 'del-question') {
                if (model.questions.length <= 1) { ctx.toast('Нельзя удалить последний вопрос', true); return; }
                if (!confirm('Удалить вопрос ' + (current + 1) + '?')) return;
                model.questions.splice(current, 1);
                current = Math.max(0, current - 1);
                render(); ctx.changed();
            } else if (act === 'add-answer') {
                item.answers.push(blankAnswer(false));
                render(); ctx.changed();
            } else if (act === 'del-answer') {
                const index = +action.dataset.ai;
                if ((item.answers || []).length <= 1) { ctx.toast('Нужен хотя бы один ответ', true); return; }
                const wasCorrect = item.answers[index].correct;
                item.answers.splice(index, 1);
                if (wasCorrect && item.answers[0]) {
                    item.answers[0].correct = true;
                    item.answers[0].fraction = 100;
                }
                render(); ctx.changed();
            }
        });

        return {
            render,
            getModel: () => model,
            setModel(next) {
                model = next && next.questions ? next : { questions: [blankQuestion('multichoice')] };
                if (!model.questions.length) model.questions.push(blankQuestion('multichoice'));
                current = 0;
            },
        };
    }

    window.MtV3Types.register({
        id: 'mt',
        label: 'Moodle Quiz',
        short: 'MOODLE',
        fileBase: 'quiz',
        gistFilename: 'quiz.xml',
        taskApp: { baseUrl: 'https://tregubovvn.github.io/mt_v2/index.html', paramName: 'name' },
        serverType: 'MoodleTest',
        promptPreset: 'mt_v2',
        rootTag: 'quiz',
        matches: root => root === 'quiz',
        sample, parse, build, title, stats, validate, createEditor,
    });
})();
