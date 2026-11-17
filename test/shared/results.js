'use strict';

/* =========================================================================
   Единое окно результатов для всех видов тестирования (rt · mt · ft).

   Одна реализация на всех: итоговая сводка, сохранение результата в
   Student Tracker (по ИД студента) и разбор ответов (только верные).
   Оформление — своё (results.css), чтобы результат выглядел одинаково
   независимо от темы конкретного приложения тестирования.

   Использование:
     Mt3Results.render(hostElement, payload)

   payload = {
     fio, group, grade, percent, topic,
     startStr, endStr, timeStr,
     rows: [['Ошибки', '2']],              // дополнительные строки (необязательно)
     details: { note, items: [{ label, text, answer, answerHtml }] },
     save: { activity, grade, comment, idKey, hint }  // сохранение в Student Tracker
   }
   ========================================================================= */

(function () {
    const SUPABASE_URL = 'https://nfoynqfjkvgtqsgwxves.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mb3lucWZqa3ZndHFzZ3d4dmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNzc3NDUsImV4cCI6MjEwODk1Mzc0NX0.SR2krMy390zOPeVwUjdBAhufwcj57Kk8VQXqFBu3Fdo';
    const TRACKER_STUDENT_PAGE = 'https://tregubovvn.github.io/save_all_result/public/student.html';
    const GRADE_NAMES = { 5: 'отлично', 4: 'хорошо', 3: 'удовлетворительно', 2: 'неудовлетворительно' };

    let current = null;   // последний payload
    let hostEl = null;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function summaryRows(p) {
        const rows = [];
        rows.push(['ФИО', (p.fio || '—') + (p.group ? ' Группа: ' + p.group : '')]);
        rows.push(['Оценка', (p.grade || '—') + ' (' + (GRADE_NAMES[p.grade] || '—') + '), ' +
            (p.percent == null ? '—' : p.percent) + '% правильных ответов']);
        rows.push(['Тема', p.topic || '—']);
        rows.push(['Начало теста', (p.startStr || '—') + ' Окончание теста: ' + (p.endStr || '') ]);
        rows.push(['Затраченное время', p.timeStr || '—']);
        (p.rows || []).forEach(r => rows.push(r));
        return rows;
    }

    function detailsHtml(details) {
        const items = (details && details.items) || [];
        const note = (details && details.note) || 'Показаны только вопросы, на которые был дан правильный ответ';
        let html = '<h3 class="mt3r-title">Разбор ответов</h3>'
            + '<p class="mt3r-note">' + esc(note) + '</p>';

        if (!items.length) {
            return html + '<p class="mt3r-note">Нет вопросов, отвеченных правильно</p>';
        }

        html += items.map((it, i) => {
            const answer = it.answerHtml != null
                ? '<div class="mt3r-answer">' + it.answerHtml + '</div>'
                : '<div class="mt3r-answer">Ответ: ' + esc(it.answer == null ? '' : it.answer) + '</div>';
            const textHtml = it.textHtml != null
                ? '<div class="mt3r-item-text">' + it.textHtml + '</div>'
                : (it.text ? '<div class="mt3r-item-text">' + esc(it.text) + '</div>' : '');
            return '<div class="mt3r-item">'
                + '<div class="mt3r-item-status">' + esc(it.label || ('Вопрос ' + (i + 1) + '. ✓ Верно')) + '</div>'
                + textHtml
                + answer
                + '</div>';
        }).join('');
        return html;
    }

    function saveHtml(save) {
        if (!save) return '';
        const hint = save.hint || 'Введите ваш ИД (студенческий билет) — остальная информация (ФИО, группа, '
            + 'название теста, вопросы, правильные ответы, время) возьмётся из результатов автоматически. '
            + 'После сохранения все оценки откроются в новой вкладке.';
        return '<div class="mt3r-block mt3r-save">'
            + '<h3 class="mt3r-title">💾 Сохранение результата</h3>'
            + '<p class="mt3r-note">' + esc(hint) + '</p>'
            + '<input class="mt3r-input" type="text" id="mt3rStudentId" placeholder="ИД студента (студенческий билет)" autocomplete="off">'
            + '<button class="mt3r-btn" type="button" id="mt3rSaveBtn">💾 Сохранить результат</button>'
            + '<div class="mt3r-status" id="mt3rSaveStatus"></div>'
            + '</div>';
    }

    function setStatus(text, kind) {
        const box = document.getElementById('mt3rSaveStatus');
        if (!box) return;
        box.textContent = text || '';
        box.className = 'mt3r-status' + (kind ? ' ' + kind : '');
    }

    function setBusy(busy) {
        const btn = document.getElementById('mt3rSaveBtn');
        if (btn) {
            btn.disabled = busy;
            btn.textContent = busy ? 'Сохранение…' : '💾 Сохранить результат';
        }
    }

    // --- Student Tracker (Supabase records) ---

    function sbHeaders(extra) {
        return Object.assign({
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
        }, extra || {});
    }

    async function trackerFetch(studentId, limit) {
        let url = SUPABASE_URL + '/rest/v1/records?student_id=eq.' + encodeURIComponent(studentId)
            + '&order=date_time.desc';
        if (limit) url += '&limit=' + limit;
        url += '&apikey=' + encodeURIComponent(SUPABASE_KEY);
        const resp = await fetch(url, { headers: sbHeaders() });
        if (!resp.ok) throw new Error('Ошибка загрузки записей (' + resp.status + ')');
        const json = await resp.json();
        return Array.isArray(json) ? json : [];
    }

    async function trackerSave(record) {
        const last = await trackerFetch(record.student_id, 1);
        if (last.length) {
            const diff = (Date.now() - new Date(last[0].date_time).getTime()) / 60000;
            if (diff < 10) {
                throw new Error('Можно сохранять не чаще раза в 10 минут. Подождите ещё ' +
                    Math.ceil(10 - diff) + ' мин.');
            }
        }
        const resp = await fetch(SUPABASE_URL + '/rest/v1/records?apikey=' + encodeURIComponent(SUPABASE_KEY), {
            method: 'POST',
            headers: sbHeaders({ 'Prefer': 'return=minimal' }),
            body: JSON.stringify(record),
        });
        if (!(resp.ok || resp.status === 201)) {
            const text = await resp.text().catch(() => '');
            throw new Error('Ошибка сервера: ' + text.slice(0, 120));
        }
        return true;
    }

    async function onSave() {
        if (!current || !current.save) return;
        const input = document.getElementById('mt3rStudentId');
        const studentId = (input && input.value || '').trim();

        if (!studentId) {
            setStatus('Укажите ИД студента', 'error');
            if (input) input.focus();
            return;
        }
        if (!/^\d{4,}$/.test(studentId)) {
            setStatus('ИД должен состоять из цифр (не менее 4)', 'error');
            if (input) input.focus();
            return;
        }

        setBusy(true);
        setStatus('Сохранение…');

        try {
            await trackerSave({
                student_id: studentId,
                activity: current.save.activity || 'Тест',
                grade: String(current.save.grade || ''),
                comment: current.save.comment || '',
                date_time: new Date().toISOString(),
            });
            try { localStorage.setItem(current.save.idKey || 'mt3StudentId', studentId); } catch (e) { /* ignore */ }
            setStatus('✓ Результат сохранён. Открываю оценки…', 'ok');
            setBusy(false);
            window.open(TRACKER_STUDENT_PAGE, '_blank');
        } catch (err) {
            setStatus(err.message || 'Не удалось сохранить результат', 'error');
            setBusy(false);
        }
    }

    // --- Публичный API ---

    function render(host, payload) {
        if (!host) return;
        current = payload || {};
        hostEl = host;

        const rows = summaryRows(current).map(([label, value]) =>
            '<div class="mt3r-row"><span class="mt3r-label">' + esc(label) + ':</span>'
            + '<span class="mt3r-value">' + esc(value) + '</span></div>').join('');

        host.innerHTML = '<div class="mt3r-block">' + rows + '</div>'
            + saveHtml(current.save)
            + '<div class="mt3r-block">' + detailsHtml(current.details) + '</div>';

        host.classList.add('mt3r-host');

        const saveBtn = document.getElementById('mt3rSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', onSave);
            const input = document.getElementById('mt3rStudentId');
            try {
                const saved = localStorage.getItem((current.save && current.save.idKey) || 'mt3StudentId');
                if (saved && input) input.value = saved;
            } catch (e) { /* ignore */ }
            if (input) {
                input.addEventListener('keydown', e => { if (e.key === 'Enter') onSave(); });
                input.focus();
            }
        }

        host.scrollTop = 0;
        return host;
    }

    window.Mt3Results = { render };
})();
