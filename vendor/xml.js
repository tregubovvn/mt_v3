'use strict';

/* =========================================================================
   Минимальный XML-разбор для редактора mt_v3.
   Нужен, чтобы адаптеры типов (rt / mt / ft) работали одинаково в браузере и
   в Node-тестах: DOMParser есть только в браузере, а форматы простые.

   Узел: { name, attrs, children, text }
   text — только прямой текст/CDATA узла (без текста дочерних элементов).
   ========================================================================= */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MtV3Xml = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function decodeEntities(text) {
        return String(text || '')
            .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }

    function escapeXml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function cdata(value) {
        return '<![CDATA[' + String(value === undefined || value === null ? '' : value)
            .replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
    }

    function parseXml(source) {
        const src = String(source === undefined || source === null ? '' : source).replace(/^\uFEFF/, '');
        const len = src.length;
        let i = 0;

        function error(message) {
            throw new Error(message + ' (позиция ' + i + ')');
        }

        function skipWs() {
            while (i < len && /\s/.test(src[i])) i++;
        }

        function skipMisc() {
            for (;;) {
                skipWs();
                if (src.startsWith('<?', i)) {
                    const end = src.indexOf('?>', i + 2);
                    if (end < 0) error('незакрытая инструкция <?');
                    i = end + 2;
                } else if (src.startsWith('<!--', i)) {
                    const end = src.indexOf('-->', i + 4);
                    if (end < 0) error('незакрытый комментарий');
                    i = end + 3;
                } else if (src.startsWith('<!DOCTYPE', i)) {
                    const end = src.indexOf('>', i);
                    if (end < 0) error('незакрытый DOCTYPE');
                    i = end + 1;
                } else {
                    return;
                }
            }
        }

        function readName() {
            const start = i;
            while (i < len && /[^\s/>=\[]/.test(src[i])) i++;
            return src.slice(start, i);
        }

        function readAttrs(node) {
            for (;;) {
                skipWs();
                if (i >= len) error('не закрыт тег <' + node.name + '>');
                if (src[i] === '/' || src[i] === '>') return;
                const name = readName();
                if (!name) error('ожидалось имя атрибута');
                skipWs();
                if (src[i] !== '=') error('ожидалось = после атрибута ' + name);
                i++;
                skipWs();
                const quote = src[i];
                if (quote !== '"' && quote !== "'") error('ожидалось значение атрибута ' + name);
                i++;
                const start = i;
                while (i < len && src[i] !== quote) i++;
                if (i >= len) error('не закрыто значение атрибута ' + name);
                node.attrs[name] = decodeEntities(src.slice(start, i));
                i++;
            }
        }

        function parseElement() {
            if (src[i] !== '<') error('ожидался <');
            i++;
            const node = { name: readName(), attrs: {}, children: [], text: '' };
            if (!node.name) error('пустое имя тега');
            readAttrs(node);
            skipWs();
            if (src[i] === '/') {
                i++;
                if (src[i] !== '>') error('ожидался >');
                i++;
                return node;
            }
            if (src[i] !== '>') error('ожидался > в теге <' + node.name + '>');
            i++;

            let text = '';
            while (i < len) {
                if (src.startsWith('</', i)) {
                    i += 2;
                    const name = readName();
                    skipWs();
                    if (src[i] !== '>') error('ожидался > в закрывающем теге');
                    i++;
                    if (name !== node.name) {
                        error('не совпадает закрывающий тег: <' + name + '> вместо </' + node.name + '>');
                    }
                    node.text = decodeEntities(text);
                    return node;
                }
                if (src.startsWith('<![CDATA[', i)) {
                    const end = src.indexOf(']]>', i + 9);
                    if (end < 0) error('незакрытый CDATA');
                    text += src.slice(i + 9, end);
                    i = end + 3;
                    continue;
                }
                if (src.startsWith('<!--', i)) {
                    const end = src.indexOf('-->', i + 4);
                    if (end < 0) error('незакрытый комментарий');
                    i = end + 3;
                    continue;
                }
                if (src[i] === '<') {
                    node.children.push(parseElement());
                    continue;
                }
                text += src[i++];
            }
            error('не закрыт тег <' + node.name + '>');
        }

        skipMisc();
        if (i >= len) throw new Error('пустой XML');
        if (src[i] !== '<') error('нет корневого элемента');
        const rootNode = parseElement();
        skipMisc();
        return rootNode;
    }

    function rootName(source) {
        try { return parseXml(source).name; } catch (e) { return ''; }
    }

    function children(node, name) {
        if (!node) return [];
        return (node.children || []).filter(child => child.name === name);
    }

    function child(node, name) {
        return children(node, name)[0] || null;
    }

    function textOf(node, name) {
        const found = child(node, name);
        return found ? String(found.text || '').trim() : '';
    }

    function findAll(node, name, acc) {
        const out = acc || [];
        if (!node) return out;
        (node.children || []).forEach(item => {
            if (item.name === name) out.push(item);
            findAll(item, name, out);
        });
        return out;
    }

    function attr(node, name, fallback) {
        if (!node || !node.attrs || node.attrs[name] === undefined) return fallback === undefined ? '' : fallback;
        return node.attrs[name];
    }

    function intAttr(node, name, fallback) {
        const value = parseInt(attr(node, name, ''), 10);
        return Number.isFinite(value) ? value : fallback;
    }

    return {
        parseXml, rootName, children, child, textOf, findAll, attr, intAttr,
        escapeXml, cdata, decodeEntities,
    };
});
