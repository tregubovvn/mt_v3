'use strict';

/* =========================================================================
   Тесты форматов mt_v3: разбор, сборка и повторный разбор XML всех трёх типов.
   Запуск: node tests/formats.test.js
   ========================================================================= */

const assert = require('node:assert');
const path = require('node:path');

global.window = global;
global.MtV3Xml = require(path.join(__dirname, '..', 'vendor', 'xml.js'));
require(path.join(__dirname, '..', 'vendor', 'latex-fragments.js'));
require(path.join(__dirname, '..', 'editors', 'registry.js'));
require(path.join(__dirname, '..', 'editors', 'rt.js'));
require(path.join(__dirname, '..', 'editors', 'mt.js'));
require(path.join(__dirname, '..', 'editors', 'ft.js'));

const types = global.MtV3Types;

const results = { passed: 0, failed: 0 };
const failures = [];

function test(name, fn) {
    try {
        fn();
        results.passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        results.failed++;
        failures.push({ name, error: e });
        console.log('  FAIL ' + name + ' :: ' + e.message);
    }
}

function eq(actual, expected, message) {
    assert.deepStrictEqual(actual, expected, message);
}

function roundtrip(id) {
    const type = types.get(id);
    const first = type.parse(type.sample());
    const xml = type.build(first);
    const second = type.parse(xml);
    eq(second, first, 'round-trip ' + id);
    return { first, xml, second };
}

/* --------------------------------- Тесты --------------------------------- */

console.log('\nmt_v3 formats\n');

test('реестр: три типа и автоопределение по корню', () => {
    eq(types.list().map(t => t.id), ['rt', 'mt', 'ft']);
    eq(types.detect(types.get('rt').sample()).id, 'rt');
    eq(types.detect(types.get('mt').sample()).id, 'mt');
    eq(types.detect(types.get('ft').sample()).id, 'ft');
    eq(types.detect('<unknown/>'), null);
});

test('XML-парсер: атрибуты, CDATA, сущности, комментарии', () => {
    const X = global.MtV3Xml;
    const root = X.parseXml('<?xml version="1.0"?>\n<!-- c -->\n<root a="1" b="two &amp; three">' +
        '<child><![CDATA[<p>x & y</p>]]></child><empty/></root>');
    eq(root.name, 'root');
    eq(root.attrs.a, '1');
    eq(root.attrs.b, 'two & three');
    eq(X.child(root, 'child').text, '<p>x & y</p>');
    eq(X.child(root, 'empty').name, 'empty');
});

test('XML-парсер: ошибки не глотаются', () => {
    const X = global.MtV3Xml;
    assert.throws(() => X.parseXml('<a><b></a>'), /не совпадает закрывающий тег/);
    assert.throws(() => X.parseXml('<a>'), /не закрыт тег/);
    assert.throws(() => X.parseXml('text'), /нет корневого элемента/);
});

test('rt: структура, round-trip и ошибки', () => {
    const { first, xml } = roundtrip('rt');
    assert.ok(xml.includes('<readingTest>'));
    assert.ok(xml.includes('<topicName>'));
    eq(first.fragments.length, 1);
    eq(first.fragments[0].questions.length, 2);
    eq(first.fragments[0].questions[0].type, 'choice');
    eq(first.fragments[0].questions[0].options.filter(o => o.correct).length, 1);
    eq(first.fragments[0].questions[1].answer, 'внимание');
    assert.throws(() => types.get('rt').parse('<quiz/>'), /readingTest/);
});

test('rt: валидация находит ошибки', () => {
    const type = types.get('rt');
    const model = type.parse(type.sample());
    model.topicName = '';
    model.fragments[0].questions[0].options.forEach(o => { o.correct = false; });
    model.fragments[0].questions[1].answer = '';
    const issues = type.validate(model);
    assert.ok(issues.some(i => i.level === 'error' && /правильных/.test(i.text)));
    assert.ok(issues.some(i => i.level === 'error' && /не задан ответ/.test(i.text)));
    assert.ok(issues.some(i => i.level === 'warn' && /название темы/.test(i.text)));
});

test('mt: multichoice + shortanswer, round-trip', () => {
    const { first, xml } = roundtrip('mt');
    assert.ok(xml.includes('<quiz>'));
    assert.ok(xml.includes('type="multichoice"'));
    eq(first.questions.length, 2);
    eq(first.questions[0].single, true);
    eq(first.questions[0].answers.filter(a => a.correct).length, 1);
    eq(first.questions[1].type, 'shortanswer');
    eq(first.questions[1].answers[0].text, 'альфа');
});

test('mt: truefalse / numerical / description и category', () => {
    const type = types.get('mt');
    const xml = [
        '<quiz>',
        '<question type="category"><category><text>Категория</text></category></question>',
        '<question type="truefalse"><name><text>TF</text></name>',
        '<questiontext><text>Вопрос</text></questiontext>',
        '<answer fraction="0"><text>true</text></answer>',
        '<answer fraction="100"><text>false</text></answer></question>',
        '<question type="numerical"><name><text>N</text></name>',
        '<questiontext><text>Число</text></questiontext>',
        '<answer fraction="100"><text>3.14</text><tolerance>0.01</tolerance></answer></question>',
        '<question type="description"><name><text>D</text></name>',
        '<questiontext><text>Заголовок</text></questiontext>',
        '<description><text>Описание раздела</text></description></question>',
        '</quiz>',
    ].join('');
    const model = type.parse(xml);
    eq(model.questions.map(q => q.type), ['truefalse', 'numerical', 'description']);
    eq(model.questions[0].answers[1].correct, true);
    eq(model.questions[1].answers[0].tolerance, 0.01);
    eq(model.questions[2].text, 'Описание раздела');
    const again = type.parse(type.build(model));
    eq(again.questions.length, 3);
    eq(again.questions[0].answers[1].correct, true);
});

test('mt: валидация ловит отсутствие правильного ответа', () => {
    const type = types.get('mt');
    const model = type.parse(type.sample());
    model.questions[0].answers.forEach(a => { a.correct = false; a.fraction = 0; });
    const issues = type.validate(model);
    assert.ok(issues.some(i => i.level === 'error' && /правильный вариант/.test(i.text)));
});

test('ft: простой и расширенный формат, round-trip', () => {
    const { first, xml } = roundtrip('ft');
    assert.ok(xml.includes('<formulas name='));
    eq(first.formulas.length, 3);
    eq(first.formulas[0].latex, 'a^2 + b^2 = c^2');
    eq(first.formulas[2].symbols.length, 3);
    assert.ok(xml.includes('<symbols>'));
    assert.ok(xml.includes('<latex>'));
});

test('пустые задания: blank → build → parse', () => {
    for (const id of ['rt', 'mt', 'ft']) {
        const type = types.get(id);
        const model = type.blank();
        const back = type.parse(type.build(model));
        if (id === 'rt') eq(back.fragments.length, model.fragments.length);
        if (id === 'mt') eq(back.questions.length, model.questions.length);
        if (id === 'ft') eq(back.formulas.length, model.formulas.length);

        // Полностью пустой список тоже должен собираться и разбираться без ошибок
        const empty = id === 'rt' ? { topicName: '', meta: model.meta, fragments: [] }
            : id === 'mt' ? { questions: [] }
                : { name: '', meta: model.meta, formulas: [] };
        const round = type.parse(type.build(empty));
        eq(type.validate(round).length > 0, true);
    }
});

test('ft: валидация и фрагменты', () => {
    const type = types.get('ft');
    const model = type.parse(type.sample());
    model.formulas[0].latex = '';
    model.formulas[1].name = '';
    const issues = type.validate(model);
    assert.ok(issues.some(i => i.level === 'error' && /пустой LaTeX/.test(i.text)));
    assert.ok(issues.some(i => i.level === 'error' && /не задано название/.test(i.text)));

    const fragments = global.parseLatexToFragments('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
    assert.ok(fragments.length >= 3, 'формула делится на фрагменты');
});

console.log('\nИтого: ' + results.passed + ' passed, ' + results.failed + ' failed\n');
if (failures.length) {
    failures.forEach(f => console.log('--- ' + f.name + '\n' + (f.error.stack || f.error)));
    process.exitCode = 1;
}
