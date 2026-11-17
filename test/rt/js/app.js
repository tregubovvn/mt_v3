/**
 * RE:AD — основное приложение активного чтения.
 *
 * Экраны: авторизация -> чтение фрагментов с промежуточным тестом ->
 * финальный тест -> результаты.
 */
import { jaroWinkler } from './jaro-winkler.js';
import { parseTaskXml } from './xml-parser.js';

// --- Константы ---
const MAX_QUIZ_ERRORS = 2;          // ошибки в фрагменте до возврата к чтению
const NEXT_QUESTION_DELAY = 800;    // мс, пауза после верного ответа (промежуточный тест)
const FINAL_NEXT_DELAY = 1200;      // мс, пауза перед следующим вопросом финального теста
const WRONG_ANSWER_RESET_DELAY = 1000; // мс, сброс подсветки неверного ответа
const TEACHER_PAGE_URL = 'https://tregubovvn.github.io/rt_v2/right_answer/index.html';
const READING_PASS_RATIO = 0.6;     // доля верно отвеченных вопросов чтения для оценки «3»

// --- Состояние приложения ---
const state = {
    fragments: [],
    topicName: '',
    currentFragmentIndex: 0,
    currentQuestionIndex: 0,
    mode: 'reading',            // 'reading' | 'quiz' | 'final'
    timerId: null,
    seconds: 0,
    currentErrors: 0,
    sessionStart: null,         // момент загрузки первого экрана с заданием (мс)
    /** Прогресс режима чтения: верно отвеченные вопросы по индексам фрагментов. */
    readingProgress: [],
    summary: null,               // данные для единого окна результатов
    lastResult: null,
    results: createResults()
};

function createResults() {
    return { times: [], answers: [] };
}

// --- Элементы DOM ---
const el = {};

function cacheElements() {
    const ids = [
        'main-header', 'header-step', 'header-badge', 'error-counter-box', 'error-count',
        'pips-container', 'screen-auth', 'screen-process', 'screen-result',
        'input-fio', 'input-group-name', 'topic-name-label',
        'btn-start', 'btn-skip', 'btn-teacher', 'btn-finish', 'btn-finish-reading',
        'timer-fill', 'content-area', 'controls-area'
    ];
    ids.forEach((id) => { el[id] = document.getElementById(id); });
}

// --- Вспомогательные функции ---

function showScreen(name) {
    el['screen-auth'].classList.toggle('visible', name === 'auth');
    el['screen-process'].classList.toggle('visible', name === 'process');
    el['screen-result'].classList.toggle('visible', name === 'result');
    el['main-header'].style.display = name === 'process' ? 'flex' : 'none';
}

function setHeader(stepText, badgeText, isFinalBadge) {
    el['header-step'].textContent = stepText;
    el['header-badge'].textContent = badgeText;
    el['header-badge'].classList.toggle('badge-final', Boolean(isFinalBadge));
}

/**
 * Переключение кнопки завершения в шапке:
 * в режиме чтения — «Завершить чтение» (переход к финальному окну),
 * в режимах теста — «Завершить тест» (переход к результатам).
 */
function setFinishButton(mode) {
    const btn = el['btn-finish'];
    if (mode === 'reading') {
        btn.textContent = 'Завершить чтение';
        btn.title = 'Завершить чтение и перейти к финальному окну';
        btn.onclick = finishReading;
    } else {
        btn.textContent = 'Завершить тест';
        btn.title = 'Завершить тест и перейти к результатам';
        btn.onclick = requestFinishTest;
    }
}

/** Пройдено ли более 60% заданий режима чтения (для оценки не ниже «3»). */
function isReadingPassed() {
    const totalFragments = state.fragments.length;
    if (!totalFragments) return false;
    const passed = state.readingProgress.filter(Boolean).length;
    return passed / totalFragments > READING_PASS_RATIO;
}

function setErrorCounter(visible) {
    el['error-count'].textContent = state.currentErrors;
    el['error-counter-box'].classList.toggle('active', visible);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

/** Все вопросы всех фрагментов одним списком (для финального теста). */
function allQuestions() {
    return state.fragments.flatMap((f) => f.questions);
}

/** Текущий список вопросов в зависимости от режима. */
function currentQuestionList() {
    return state.mode === 'final'
        ? allQuestions()
        : state.fragments[state.currentFragmentIndex].questions;
}

// --- Инициализация и загрузка задания ---

function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('file') || params.get('xml');
    if (!url) return;

    fetch(url)
        .then((response) => {
            if (!response.ok) throw new Error('Network error');
            return response.text();
        })
        .then((text) => {
            if (!loadTask(text)) return;
            applyStudentFromParams(params);
        })
        .catch((err) => {
            console.error(err);
            setStatus('❌ Ошибка загрузки по ссылке');
        });
}

/**
 * ФИО и группа приходят из единого окна тестирования (test/index.html):
 * ?fio=…&group=…. Оба поля заполняются, тест стартует сразу.
 */
function applyStudentFromParams(params) {
    const fio = (params.get('fio') || '').trim();
    const group = (params.get('group') || '').trim();

    if (fio) el['input-fio'].value = fio;
    if (group) el['input-group-name'].value = group;

    if (fio) {
        startTest();
    } else {
        el['input-fio'].focus();
    }
}

function setStatus(statusText) {
    const box = document.getElementById('file-status');
    if (box) box.textContent = statusText;
}

/** Загружает XML-строку в состояние приложения. Возвращает true при успехе. */
function loadTask(xmlString) {
    try {
        const task = parseTaskXml(xmlString);
        state.fragments = task.fragments;
        state.topicName = task.topicName || '';
        el['topic-name-label'].textContent = task.topicName
            ? 'Тема: ' + task.topicName
            : 'Тема:';
        ['btn-start', 'btn-skip', 'btn-teacher'].forEach((id) => { el[id].disabled = false; });
        // «Первый экран» с заданием загружен — с этого момента идёт отсчёт времени сдачи
        state.sessionStart = Date.now();
        return true;
    } catch (err) {
        console.error(err);
        alert('Ошибка парсинга XML: ' + err.message);
        return false;
    }
}

// --- Режим чтения ---

function validateInput() {
    if (!el['input-fio'].value.trim()) {
        alert('Введите ФИО');
        return false;
    }
    if (state.fragments.length === 0) {
        alert('Нет данных');
        return false;
    }
    return true;
}

function startTest() {
    if (!validateInput()) return;

    state.currentFragmentIndex = 0;
    state.results = createResults();
    state.readingProgress = new Array(state.fragments.length).fill(false);

    showScreen('process');
    renderPips();
    showFragment();
}

function renderPips() {
    el['pips-container'].innerHTML = '';
    for (let i = 0; i <= state.fragments.length; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip';
        if (i < state.currentFragmentIndex) pip.classList.add('done');
        if (i === state.currentFragmentIndex) pip.classList.add('active');
        el['pips-container'].appendChild(pip);
    }
}

function showFragment() {
    const frag = state.fragments[state.currentFragmentIndex];

    state.mode = 'reading';
    state.currentErrors = 0;
    setErrorCounter(false);
    setHeader('Фрагмент ' + (state.currentFragmentIndex + 1), 'Чтение', false);
    setFinishButton('reading');

    restartTimer(frag);

    const content = el['content-area'];
    content.innerHTML = escapeHtml(frag.text);
    // Перезапуск анимации появления
    content.style.animation = 'none';
    void content.offsetHeight;
    content.style.animation = '';

    el['controls-area'].innerHTML =
        '<div class="controls-row">' +
        '<button class="btn" id="btn-ready">Готов к вопросам</button>' +
        '<button class="btn btn-finish-inline" id="btn-finish-reading" type="button" ' +
        'title="Завершить чтение и перейти к финальному окну">Завершить чтение</button>' +
        '</div>';
    document.getElementById('btn-ready').addEventListener('click', startQuestions);
    document.getElementById('btn-finish-reading').addEventListener('click', finishReading);
}

function restartTimer(frag) {
    clearInterval(state.timerId);
    state.seconds = 0;

    const fill = el['timer-fill'];
    fill.style.width = '0%';
    fill.classList.remove('warning', 'danger');

    state.timerId = setInterval(() => {
        state.seconds++;
        fill.style.width = Math.min(100, (state.seconds / frag.timeGood) * 100) + '%';
        fill.classList.toggle('danger', state.seconds > frag.timeGood);
        fill.classList.toggle('warning', !fill.classList.contains('danger') && state.seconds > frag.timeExcellent);
    }, 1000);
}

// --- Промежуточный тест ---

function startQuestions() {
    clearInterval(state.timerId);

    const frag = state.fragments[state.currentFragmentIndex];
    state.results.times.push({
        spent: state.seconds,
        exc: frag.timeExcellent,
        good: frag.timeGood
    });

    state.mode = 'quiz';
    state.currentQuestionIndex = 0;

    setHeader('Фрагмент ' + (state.currentFragmentIndex + 1), 'Тест', false);
    setFinishButton('quiz');
    setErrorCounter(true);

    renderQuestion();
}

function renderQuestion() {
    const list = currentQuestionList();

    if (state.currentQuestionIndex >= list.length) {
        onFragmentQuestionsFinished();
        return;
    }

    const q = list[state.currentQuestionIndex];
    el['header-step'].textContent = 'Вопрос ' + (state.currentQuestionIndex + 1);

    let html = `<div class="question-title">${escapeHtml(q.text)}</div>`;
    if (q.type === 'choice') {
        html += '<div class="options-list">' +
            q.options.map((o) => `<div class="option-item">${escapeHtml(o.text)}</div>`).join('') +
            '</div>';
    } else {
        html += '<input type="text" id="ans-input" class="answer-input" placeholder="Напишите ответ...">';
    }

    el['content-area'].innerHTML = html;
    el['controls-area'].innerHTML =
        '<div class="feedback-msg" id="fb"></div>' +
        '<div class="controls-row">' +
        '<button class="btn" id="submit-btn">Ответить</button>' +
        '<button class="btn btn-finish-inline" id="btn-finish-inline" type="button" title="Завершить тест и перейти к результатам">Завершить тест</button>' +
        '</div>';

    el['content-area'].querySelectorAll('.option-item').forEach((item) => {
        item.addEventListener('click', () => selectOption(item));
    });
    document.getElementById('submit-btn').addEventListener('click', submitAnswer);
    document.getElementById('btn-finish-inline').addEventListener('click', requestFinishTest);
}

/** Все вопросы пройдены: переход к следующему фрагменту или финальному тесту. */
function onFragmentQuestionsFinished() {
    // Фрагмент считается пройденным (для оценки за чтение)
    state.readingProgress[state.currentFragmentIndex] = true;

    if (state.currentFragmentIndex < state.fragments.length - 1) {
        state.currentFragmentIndex++;
        renderPips();
        showFragment();
    } else {
        startFinalTestStage();
    }
}

function selectOption(optionEl) {
    optionEl.parentElement.querySelectorAll('.option-item')
        .forEach((e) => e.classList.remove('selected'));
    optionEl.classList.add('selected');
}

function showFeedback(text, isSuccess) {
    const fb = document.getElementById('fb');
    fb.textContent = text;
    fb.className = 'feedback-msg ' + (isSuccess ? 'fb-success' : 'fb-error');
}

function hideFeedback() {
    const fb = document.getElementById('fb');
    if (fb) fb.style.display = 'none';
}

// --- Проверка ответа ---

/**
 * Определяет, является ли ответ пользователя правильным.
 * @returns {{value: string|null, correct: boolean}} значение ответа и результат проверки.
 */
function checkAnswer(q) {
    if (q.type === 'choice') {
        const selected = el['content-area'].querySelector('.option-item.selected');
        if (!selected) return { value: null, correct: false };
        const value = selected.textContent;
        const correct = q.options.some((o) => o.text === value && o.correct);
        return { value, correct };
    }

    const input = document.getElementById('ans-input');
    const value = input ? input.value.trim() : '';
    if (!value) return { value: null, correct: false };

    // Нестрогая проверка текстового ответа по алгоритму Jaro-Winkler
    const similarity = jaroWinkler(value.toLowerCase(), q.answer);
    return { value, correct: similarity >= q.similarity };
}

function submitAnswer() {
    const q = currentQuestionList()[state.currentQuestionIndex];
    const { value, correct } = checkAnswer(q);

    if (value === null) {
        showFeedback(q.type === 'choice' ? 'Выберите вариант' : 'Введите ответ', false);
        return;
    }

    if (state.mode === 'final') {
        handleFinalAnswer(q, value, correct);
    } else {
        handleQuizAnswer(q, correct);
    }
}

// --- Логика промежуточного теста (обучающий режим) ---

function handleQuizAnswer(q, correct) {
    if (correct) {
        showFeedback('Отлично!', true);
        state.currentErrors = 0;
        setErrorCounter(true);
        state.currentQuestionIndex++;
        setTimeout(renderQuestion, NEXT_QUESTION_DELAY);
        return;
    }

    state.currentErrors++;
    setErrorCounter(true);

    if (state.currentErrors >= MAX_QUIZ_ERRORS) {
        showFeedback('Слишком много ошибок.', false);
        setTimeout(() => {
            alert(`Допущено ${MAX_QUIZ_ERRORS} ошибки. Необходимо перечитать фрагмент.`);
            showFragment();
        }, WRONG_ANSWER_RESET_DELAY);
        return;
    }

    showFeedback('Неверно. Попробуйте еще раз.', false);

    if (q.type === 'choice') {
        el['content-area'].querySelectorAll('.option-item.selected').forEach((item) => {
            item.classList.add('wrong');
            setTimeout(() => {
                item.classList.remove('wrong', 'selected');
                hideFeedback();
            }, WRONG_ANSWER_RESET_DELAY);
        });
    } else {
        const input = document.getElementById('ans-input');
        input.classList.add('invalid');
        setTimeout(() => {
            input.classList.remove('invalid');
            hideFeedback();
        }, WRONG_ANSWER_RESET_DELAY);
    }
}

// --- Финальный тест ---

function startFinalTestStage() {
    state.mode = 'final';
    state.currentQuestionIndex = 0;
    state.currentFragmentIndex = state.fragments.length; // индикатор конца чтения

    renderPips();
    setHeader('Итог', 'Финал', true);
    setFinishButton('final');
    setErrorCounter(false);
    showFinalIntro('Начать');
}

function startFinalTestDirectly() {
    if (!validateInput()) return;

    state.results = createResults();
    showScreen('process');
    startFinalTestStage();
}

function showFinalIntro(buttonLabel) {
    el['timer-fill'].style.width = '0%';
    el['content-area'].innerHTML =
        '<div class="final-intro"><h2>Финальный тест</h2>' +
        '<p>Проверка знаний по всему материалу.</p></div>';
    el['controls-area'].innerHTML = `<button class="btn" id="btn-begin-final">${buttonLabel}</button>`;
    document.getElementById('btn-begin-final').addEventListener('click', renderQuestion);
}

function handleFinalAnswer(q, value, correct) {
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;

    if (q.type === 'choice') {
        el['content-area'].querySelectorAll('.option-item').forEach((item) => {
            item.classList.add('locked');
            const isCorrectOption = q.options.some((o) => o.text === item.textContent && o.correct);
            if (isCorrectOption) item.classList.add('correct');
            if (item.classList.contains('selected') && !correct) item.classList.add('wrong');
        });
    } else {
        const input = document.getElementById('ans-input');
        input.disabled = true;
        input.style.borderColor = correct ? 'var(--success)' : 'var(--danger)';
    }

    state.results.answers.push({ stage: 'final', text: q.text, answer: value, correct });

    showFeedback(correct ? 'Верно!' : 'Неверно', correct);

    state.currentQuestionIndex++;
    setTimeout(renderQuestion, FINAL_NEXT_DELAY);
}

// --- Результаты ---

/**
 * Оценка по результатам финального теста:
 *  - пройдено более 60% вопросов -> как минимум «3»;
 *    далее «4» и «5» — только через тестирование по порогам 70% / 85%;
 *  - не пройдено (<=60%) -> «2».
 */
function calculateGrade(correct, total) {
    if (total <= 0) return 2;
    const ratio = correct / total;
    if (ratio > READING_PASS_RATIO) {
        if (ratio >= 0.85) return 5;
        if (ratio >= 0.7) return 4;
        return 3;
    }
    return 2;
}

/** Форматирование длительности: Чч:Мм:Сс (как в mt_v2 / ft_v2). */
function formatClock(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Date -> «дд.мм.гггг, чч:мм:сс» (ru-RU), как в mt_v2. */
function formatDateTime(date) {
    return date.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// Единое окно результатов (shared/results.js): сводка, сохранение, разбор.
function renderSummary(data) {
    state.summary = data;
}

function rtPayload(data, answers) {
    const fio = (data && data.fio) || el['input-fio'].value.trim() || '—';
    const group = (data && data.group) || el['input-group-name'].value.trim() || '—';
    const r = state.lastResult || {};

    const items = (answers || [])
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a && a.correct)
        .map(({ a, i }) => ({
            label: 'Вопрос ' + (i + 1) + '. ✓ Верно',
            text: a.text || '',
            answer: a.answer || '',
        }));

    const comment = [
        'ФИО: ' + fio,
        'Группа: ' + group,
        'Тема: ' + (state.topicName || '—'),
        'Начало теста: ' + (r.startDateTimeStr || (data && data.startDateTimeStr) || '—'),
        'Окончание теста: ' + (r.endTimeStr || (data && data.endTimeStr) || '—'),
        'Затраченное время: ' + (r.timeSpentStr || (data && data.timeSpentStr) || '—'),
        'Итоговый тест: ' + (r.tookFinalTest ? 'сдавал' : 'не сдавал'),
        'Ошибок: ' + (r.errors == null ? '—' : r.errors),
    ].join('; ');

    return {
        fio: fio,
        group: group,
        grade: (data && data.grade) || r.grade,
        percent: (data && data.percent != null) ? data.percent : r.percent,
        topic: (data && data.topic) || state.topicName || '',
        startStr: (data && data.startDateTimeStr) || r.startDateTimeStr || '',
        endStr: (data && data.endTimeStr) || r.endTimeStr || '',
        timeStr: (data && data.timeSpentStr) || r.timeSpentStr || '',
        rows: [['Ошибки', r.errors == null ? '—' : String(r.errors)]],
        details: { items: items },
        save: {
            activity: 'RE:AD — ' + (state.topicName || 'тест'),
            grade: String((data && data.grade) || r.grade || ''),
            comment: comment,
            idKey: 'rtStudentTrackerId',
        },
    };
}

function finishResults(answers) {
    const host = document.getElementById('mt3Results');
    if (host && window.Mt3Results) {
        window.Mt3Results.render(host, rtPayload(state.summary, answers));
    }
}

function finishTest() {
    clearInterval(state.timerId);   // остановить таймер фрагмента

    const finalAnswers = state.results.answers.filter((a) => a.stage === 'final');
    const total = allQuestions().length;
    const correctCount = finalAnswers.filter((a) => a.correct).length;
    const errors = finalAnswers.length - correctCount;
    const grade = calculateGrade(correctCount, total);
    const percent = total > 0 ? Math.round(correctCount / total * 100) : 0;

    // Затраченное время — с момента загрузки первого экрана (экран авторизации)
    const elapsedMs = state.sessionStart ? (Date.now() - state.sessionStart) : 0;
    const elapsedSec = Math.round(elapsedMs / 1000);

    const now = new Date();
    const startDateTimeStr = state.sessionStart ? formatDateTime(new Date(state.sessionStart)) : '';
    const endTimeStr = now.toLocaleTimeString('ru-RU');

    renderSummary({
        fio: el['input-fio'].value.trim(),
        group: el['input-group-name'].value.trim(),
        grade: grade,
        percent: percent,
        topic: state.topicName,
        startDateTimeStr: startDateTimeStr,
        endTimeStr: endTimeStr,
        timeSpentStr: formatClock(elapsedSec)
    });

    state.lastResult = {
        grade: grade,
        percent: percent,
        errors: errors,
        elapsedSec: elapsedSec,
        tookFinalTest: true,
        startDateTimeStr: startDateTimeStr,
        endTimeStr: endTimeStr,
        timeSpentStr: formatClock(elapsedSec)
    };

    renderDetailedResults(state.results.answers);
    finishResults(state.results.answers);
    showScreen('result');
}

/** Кнопка «Завершить тест»: немедленный переход к окну результатов. */
function requestFinishTest() {
    finishTest();
}

/**
 * Кнопка «Завершить чтение» (рядом с «Готов к вопросам» и в шапке):
 * переход к финальному окну. Если пройдено более 60% заданий чтения —
 * сразу ставится оценка «3» (выше — только через финальное тестирование),
 * иначе открывается окно финального теста.
 */
function finishReading() {
    if (state.mode !== 'reading') return;   // защита от повторного нажатия

    clearInterval(state.timerId);           // остановить таймер фрагмента

    if (isReadingPassed()) {
        showResultsFromReading();
    } else {
        startFinalTestStage();
    }
}

/** Окно результатов при завершении чтения (оценка «3» за пройденные >60% заданий). */
function showResultsFromReading() {
    const elapsedMs = state.sessionStart ? (Date.now() - state.sessionStart) : 0;
    const elapsedSec = Math.round(elapsedMs / 1000);

    const now = new Date();
    const startDateTimeStr = state.sessionStart ? formatDateTime(new Date(state.sessionStart)) : '';
    const endTimeStr = now.toLocaleTimeString('ru-RU');

    const totalFragments = state.fragments.length;
    const passedFragments = state.readingProgress.filter(Boolean).length;
    const percent = totalFragments > 0 ? Math.round(passedFragments / totalFragments * 100) : 0;

    renderSummary({
        fio: el['input-fio'].value.trim(),
        group: el['input-group-name'].value.trim(),
        grade: 3,
        percent: percent,
        topic: state.topicName,
        startDateTimeStr: startDateTimeStr,
        endTimeStr: endTimeStr,
        timeSpentStr: formatClock(elapsedSec)
    });

    state.lastResult = {
        grade: 3,
        percent: percent,
        errors: '—',
        elapsedSec: elapsedSec,
        tookFinalTest: false,
        startDateTimeStr: startDateTimeStr,
        endTimeStr: endTimeStr,
        timeSpentStr: formatClock(elapsedSec)
    };

    renderDetailedResults([]);
    finishResults([]);
    showScreen('result');
}

// Разбор ответов и сохранение рисует единое окно результатов (shared/results.js).
function renderDetailedResults() { /* отрисовка — в Mt3Results.render() */ }

// --- Переход в режим преподавателя ---

function redirectToTeacherPage() {
    const fileParam = new URLSearchParams(window.location.search).get('file');
    if (!fileParam) {
        console.warn('Параметр "file" не найден в URL');
        return;
    }
    window.location.href = `${TEACHER_PAGE_URL}?xml=${encodeURIComponent(fileParam)}`;
}

// --- Точка входа ---

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();

    el['btn-start'].addEventListener('click', startTest);
    el['btn-skip'].addEventListener('click', startFinalTestDirectly);
    el['btn-teacher'].addEventListener('click', redirectToTeacherPage);
    // Обработчик кнопки завершения в шапке назначается через setFinishButton()
    // («Завершить чтение» в режиме чтения / «Завершить тест» в режимах теста)

    initFromUrl();
});
