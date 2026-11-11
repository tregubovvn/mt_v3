'use strict';

/* =========================================================================
   Тип XML: Formula Test, корень <formulas>.
   Свой редактор: название теста, формулы (LaTeX), условные обозначения,
   предпросмотр KaTeX и разбиение на фрагменты (как в тестирующем приложении).
   ========================================================================= */

(function () {
    const X = window.MtV3Xml;
    const esc = X.escapeXml;

    /* ------------------------------- Модель ------------------------------- */

    function emptyMeta() {
        return { author: '', discipline: '', university: '', audience: '' };
    }

    function blankFormula() {
        return { name: '', latex: '', symbols: [] };
    }

    function blank() {
        return { name: '', meta: emptyMeta(), formulas: [blankFormula()] };
    }

    /* ------------------------------ Пример ------------------------------ */

    function sample() {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<formulas name="Демонстрационный тест">',
            '  <meta author="" discipline="" university="" audience="" />',
            '  <formula name="Теорема Пифагора">a^2 + b^2 = c^2</formula>',
            '  <formula name="Квадратное уравнение">x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}</formula>',
            '  <formula name="Кинетическая энергия">',
            '    <latex>E_k = \\frac{m v^2}{2}</latex>',
            '    <symbols>',
            '      <symbol char="E_k" name="кинетическая энергия" />',
            '      <symbol char="m" name="масса тела" />',
            '      <symbol char="v" name="скорость тела" />',
            '    </symbols>',
            '  </formula>',
            '</formulas>',
        ].join('\n');
    }

    /* -------------------------------- Разбор -------------------------------- */

    function parse(xml) {
        const root = X.parseXml(xml);
        if (root.name !== 'formulas') throw new Error('ожидался корень <formulas>');

        const metaNode = X.child(root, 'meta');
        const formulas = X.children(root, 'formula').map(node => {
            const latexNode = X.child(node, 'latex');
            const symbols = X.children(X.child(node, 'symbols'), 'symbol').map(s => ({
                char: X.attr(s, 'char'),
                name: X.attr(s, 'name'),
            }));
            return {
                name: X.attr(node, 'name'),
                latex: latexNode ? String(latexNode.text || '').trim() : String(node.text || '').trim(),
                symbols,
            };
        });

        return {
            name: X.attr(root, 'name'),
            meta: metaNode ? {
                author: X.attr(metaNode, 'author'),
                discipline: X.attr(metaNode, 'discipline'),
                university: X.attr(metaNode, 'university'),
                audience: X.attr(metaNode, 'audience'),
            } : emptyMeta(),
            formulas,
        };
    }

    /* -------------------------------- Сборка -------------------------------- */

    function build(model) {
        const meta = model.meta || emptyMeta();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<formulas name="' + esc(model.name || '') + '">\n';
        if (meta.author || meta.discipline || meta.university || meta.audience) {
            xml += '  <meta author="' + esc(meta.author) + '" discipline="' + esc(meta.discipline) +
                '" university="' + esc(meta.university) + '" audience="' + esc(meta.audience) + '" />\n';
        }
        (model.formulas || []).forEach(formula => {
            const symbols = (formula.symbols || []).filter(s => (s.char || '').trim() || (s.name || '').trim());
            if (symbols.length) {
                xml += '  <formula name="' + esc(formula.name) + '">\n';
                xml += '    <latex>' + esc(formula.latex) + '</latex>\n';
                xml += '    <symbols>\n';
                symbols.forEach(s => {
                    xml += '      <symbol char="' + esc(s.char) + '" name="' + esc(s.name) + '" />\n';
                });
                xml += '    </symbols>\n';
                xml += '  </formula>\n';
            } else {
                xml += '  <formula name="' + esc(formula.name) + '">' + esc(formula.latex) + '</formula>\n';
            }
        });
        xml += '</formulas>';
        return xml;
    }

    /* ------------------------------ Метаданные ------------------------------ */

    function title(model) {
        return (model && model.name) || 'Formula Test';
    }

    function stats(model) {
        const formulas = (model && model.formulas) || [];
        const symbols = formulas.reduce((sum, f) => sum + (f.symbols || []).length, 0);
        return 'Формул: ' + formulas.length + ' · обозначений: ' + symbols;
    }

    function fragmentsOf(latex) {
        try {
            return typeof window.parseLatexToFragments === 'function'
                ? window.parseLatexToFragments(latex || '')
                : [];
        } catch (e) {
            return [];
        }
    }

    function validate(model) {
        const issues = [];
        const formulas = (model && model.formulas) || [];
        if (!(model.name || '').trim()) issues.push({ level: 'warn', text: 'Не задано название теста' });
        if (!formulas.length) issues.push({ level: 'error', text: 'Нет ни одной формулы' });

        formulas.forEach((formula, index) => {
            const label = 'Формула ' + (index + 1);
            if (!(formula.name || '').trim()) issues.push({ level: 'error', text: label + ': не задано название' });
            if (!(formula.latex || '').trim()) {
                issues.push({ level: 'error', text: label + ': пустой LaTeX' });
                return;
            }
            const fragments = fragmentsOf(formula.latex);
            if (fragments.length < 2) issues.push({ level: 'warn', text: label + ': меньше двух фрагментов сборки' });
            const unique = new Set(fragments);
            if (unique.size !== fragments.length) {
                issues.push({ level: 'warn', text: label + ': одинаковые фрагменты — порядок сборки неоднозначен' });
            }
            (formula.symbols || []).forEach((symbol, si) => {
                if (!(symbol.char || '').trim() || !(symbol.name || '').trim()) {
                    issues.push({ level: 'warn', text: label + ', обозначение ' + (si + 1) + ': заполните символ и расшифровку' });
                }
            });
        });

        return issues;
    }

    /* ------------------------------- Редактор ------------------------------- */

    function createEditor(container, ctx) {
        let model = { name: '', meta: emptyMeta(), formulas: [blankFormula()] };
        let current = 0;

        container.innerHTML = [
            '<div class="ed-top">',
            '  <label class="field grow"><span class="label">Название теста</span>',
            '    <input class="input" data-ft="name" placeholder="Название теста"></label>',
            '  <details class="meta-box"><summary>Метаданные</summary>',
            '    <div class="grid2">',
            '      <label class="field"><span class="label">Автор</span><input class="input" data-meta="author"></label>',
            '      <label class="field"><span class="label">Университет</span><input class="input" data-meta="university"></label>',
            '      <label class="field"><span class="label">Дисциплина</span><input class="input" data-meta="discipline"></label>',
            '      <label class="field"><span class="label">Аудитория</span><input class="input" data-meta="audience"></label>',
            '    </div>',
            '  </details>',
            '</div>',
            '<div class="tabs" data-ft="tabs"></div>',
            '<div class="ed-toolbar">',
            '  <button type="button" class="btn btn-sm" data-act="add-formula">＋ Формула</button>',
            '  <button type="button" class="btn btn-sm btn-danger" data-act="del-formula">Удалить формулу</button>',
            '  <span class="hint" data-ft="info"></span>',
            '</div>',
            '<div class="ed-body" data-ft="body"></div>',
        ].join('');

        const els = {
            name: container.querySelector('[data-ft="name"]'),
            tabs: container.querySelector('[data-ft="tabs"]'),
            body: container.querySelector('[data-ft="body"]'),
            info: container.querySelector('[data-ft="info"]'),
            meta: Array.from(container.querySelectorAll('[data-meta]')),
        };

        function formula() { return model.formulas[current]; }

        function renderPreview() {
            const item = formula();
            const math = els.body.querySelector('[data-ft="math"]');
            const fragmentsBox = els.body.querySelector('[data-ft="fragments"]');
            if (!math || !fragmentsBox) return;

            if (window.katex && typeof window.katex.render === 'function' && (item.latex || '').trim()) {
                try {
                    window.katex.render(item.latex, math, { throwOnError: true, displayMode: true });
                } catch (e) {
                    math.textContent = 'Ошибка LaTeX: ' + e.message;
                    math.classList.add('error');
                }
            } else {
                math.textContent = (item.latex || '').trim() || '— формула пуста —';
            }

            const fragments = fragmentsOf(item.latex);
            fragmentsBox.innerHTML = fragments.length
                ? fragments.map((f, i) => '<span class="frag"><em>' + (i + 1) + '</em>' + esc(f) + '</span>').join('')
                : '<span class="hint">Фрагменты появятся, когда формула будет заполнена.</span>';
        }

        function render() {
            if (document.activeElement !== els.name) els.name.value = model.name || '';
            els.meta.forEach(input => {
                if (document.activeElement !== input) input.value = (model.meta || emptyMeta())[input.dataset.meta] || '';
            });

            if (!model.formulas.length) {
                current = -1;
                els.tabs.innerHTML = '';
                els.info.textContent = 'Формул нет';
                els.body.innerHTML = '<div class="empty-state">' +
                    '<p>Формул пока нет.</p>' +
                    '<div class="empty-actions">' +
                    '<button type="button" class="btn btn-sm btn-primary" data-act="add-formula">＋ Формула</button>' +
                    '</div></div>';
                return;
            }
            if (current < 0 || current >= model.formulas.length) current = 0;

            els.tabs.innerHTML = model.formulas.map((f, i) => {
                const bad = !(f.name || '').trim() || !(f.latex || '').trim();
                return '<button type="button" class="tab' + (i === current ? ' active' : '') + (bad ? ' warn' : '') +
                    '" data-nav="' + i + '">' + (i + 1) + '. ' + esc(f.name || 'формула') + '</button>';
            }).join('');

            const item = formula();
            els.info.textContent = 'LaTeX: ' + (item.latex || '').length + ' символов · обозначений: ' + (item.symbols || []).length;
            els.body.innerHTML = [
                '<label class="field"><span class="label">Название формулы (его видит студент)</span>',
                '  <input class="input" data-ff="name" value="' + esc(item.name || '') + '"></label>',
                '<label class="field"><span class="label">LaTeX</span>',
                '  <textarea class="textarea code" rows="4" data-ff="latex" spellcheck="false">' + esc(item.latex || '') + '</textarea></label>',
                '<div class="preview-box"><div class="label">Предпросмотр</div><div class="math" data-ft="math"></div></div>',
                '<div class="preview-box"><div class="label">Фрагменты сборки (порядок = правильный ответ)</div>',
                '  <div class="fragments" data-ft="fragments"></div></div>',
                '<div class="field"><span class="label">Условные обозначения</span><div class="ans-list">',
                (item.symbols || []).map((s, si) => [
                    '<div class="ans-row" data-si="' + si + '">',
                    '  <input class="input input-sm" data-sf="char" value="' + esc(s.char || '') + '" placeholder="E_k">',
                    '  <input class="input" data-sf="name" value="' + esc(s.name || '') + '" placeholder="расшифровка">',
                    '  <button type="button" class="icon-btn" data-act="del-symbol" data-si="' + si + '">✕</button>',
                    '</div>',
                ].join('')).join(''),
                '</div>',
                '<button type="button" class="btn btn-sm btn-ghost" data-act="add-symbol">＋ обозначение</button></div>',
            ].join('');

            renderPreview();
        }

        container.addEventListener('input', event => {
            const t = event.target;
            if (t.matches('[data-ft="name"]')) { model.name = t.value; ctx.changed(); return; }
            if (t.matches('[data-meta]')) {
                model.meta = model.meta || emptyMeta();
                model.meta[t.dataset.meta] = t.value;
                ctx.changed();
                return;
            }
            if (t.matches('[data-ff]')) {
                const item = formula();
                if (!item) return;
                item[t.dataset.ff] = t.value;
                if (t.dataset.ff === 'latex') renderPreview();
                ctx.changed();
                return;
            }
            if (t.matches('[data-sf]')) {
                const item = formula();
                if (!item) return;
                const row = t.closest('[data-si]');
                const symbol = item.symbols[+row.dataset.si];
                if (symbol) {
                    symbol[t.dataset.sf] = t.value;
                    ctx.changed();
                }
            }
        });

        /* Своё окно подтверждения вместо системного confirm(): браузеры глушат
           системные диалоги, и тогда кнопки удаления молча не работают. */
        function ask(message, okLabel) {
            if (ctx.confirm) return ctx.confirm(message, { okLabel: okLabel });
            return Promise.resolve(window.confirm(message));
        }

        container.addEventListener('click', async event => {
            const nav = event.target.closest('[data-nav]');
            if (nav) { current = +nav.dataset.nav; render(); return; }

            const action = event.target.closest('[data-act]');
            if (!action) return;
            const act = action.dataset.act;
            let item = formula();

            if (act === 'add-formula') {
                model.formulas.push(blankFormula());
                current = model.formulas.length - 1;
                render(); ctx.changed();
            } else if (act === 'del-formula') {
                if (!item) { ctx.toast('Формул нет', true); return; }
                if (!(await ask('Удалить формулу ' + (current + 1) + '?', 'Удалить'))) return;
                model.formulas.splice(current, 1);
                current = Math.min(current, model.formulas.length - 1);
                render(); ctx.changed();
                ctx.toast('Формула удалена');
            } else if (act === 'add-symbol') {
                if (!item) {
                    item = blankFormula();
                    model.formulas.push(item);
                    current = model.formulas.length - 1;
                }
                item.symbols.push({ char: '', name: '' });
                render(); ctx.changed();
            } else if (act === 'del-symbol') {
                if (!item) { ctx.toast('Обозначений нет', true); return; }
                item.symbols.splice(+action.dataset.si, 1);
                render(); ctx.changed();
            }
        });

        return {
            render,
            getModel: () => model,
            getIndex: () => current,
            setModel(next) {
                model = next && next.formulas ? next : { name: '', meta: emptyMeta(), formulas: [] };
                current = model.formulas.length ? 0 : -1;
            },
        };
    }

    /* ------------------------------- Просмотр ------------------------------- */

    function count(model) {
        return ((model && model.formulas) || []).length;
    }

    function itemLabel(index) {
        return 'Формула ' + (index + 1);
    }

    // Детерминированная перестановка: студент видит фрагменты перемешанными,
    // но при повторном открытии порядка не «прыгает».
    function shuffle(items, seed) {
        const list = items.slice();
        let state = (seed >>> 0) || 1;
        const rnd = () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 4294967296;
        };
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }

    function preview(model, index, opts) {
        const formula = ((model && model.formulas) || [])[index];
        if (!formula) return '<p class="hint">Формула не выбрана.</p>';
        const show = !!(opts && opts.showAnswers);
        const symbols = (formula.symbols || []).filter(s =>
            String(s.char || '').trim() || String(s.name || '').trim());
        const fragments = fragmentsOf(formula.latex);
        const shown = show ? fragments : shuffle(fragments, index + 11 + (formula.latex || '').length);

        let html = '<article class="pv-formula">';
        html += '<div class="pv-formula-name">' + esc(formula.name || '—') + '</div>';
        if (symbols.length) {
            html += '<div class="pv-symbols">' + symbols.map(s =>
                '<div class="pv-symbol">' +
                '<span class="pv-symbol-char" data-latex="' + esc(s.char || '') + '" data-display="inline"></span>' +
                '<span class="pv-symbol-name">' + esc(s.name || '') + '</span></div>').join('') + '</div>';
        }
        if (shown.length) {
            html += '<div class="pv-fragments">' + shown.map(fragment =>
                '<span class="pv-token">' + esc(fragment) + '</span>').join('') + '</div>';
            html += '<p class="hint">' + (show
                ? 'Порядок фрагментов — правильный ответ.'
                : 'Фрагменты перемешаны — как их увидит студент.') + '</p>';
        }
        if (show && formula.latex) {
            html += '<div class="pv-answer-formula"><div class="hint">Формула:</div>' +
                '<div class="pv-math" data-latex="' + esc(formula.latex) + '"></div></div>';
        }
        return html + '</article>';
    }

    window.MtV3Types.register({
        id: 'ft',
        label: 'Formula Test',
        short: 'FORMULAS',
        fileBase: 'formula_test',
        gistFilename: 'formula_test.xml',
        taskApp: { baseUrl: 'https://tregubovvn.github.io/ft/index.html', paramName: 'file' },
        serverType: 'FormulaTest',
        promptPreset: null,
        // У редактора формул свои два базовых промпта (Gist'ы ft_v2).
        promptBuiltins: [
            { id: 'ft-formulas', name: 'Промпт для формул', gistUrl: 'https://gist.github.com/tregubovvn/e32e6561ac50b1866e5cb9de2a238f68' },
            { id: 'ft-tasks', name: 'Промпт для задач', gistUrl: 'https://gist.github.com/tregubovvn/195317d885acce603759b1cdcf6942e4' },
        ],
        rootTag: 'formulas',
        matches: root => root === 'formulas',
        sample, blank, parse, build, title, stats, validate, createEditor,
        count, itemLabel, preview,
    });
})();
