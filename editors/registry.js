'use strict';

/* =========================================================================
   Реестр типов XML. Каждый тип — отдельный «редактор» со своим разбором,
   сборкой и формой; всё остальное (файлы, публикация, промпты, AI) — общее.
   ========================================================================= */

(function () {
    const order = ['rt', 'mt', 'ft'];
    const types = {};

    window.MtV3Types = {
        order,
        register(def) {
            if (!def || !def.id) throw new Error('У типа должен быть id');
            types[def.id] = def;
        },
        get(id) { return types[id] || null; },
        list() { return order.map(id => types[id]).filter(Boolean); },
        detect(xml) {
            let root = '';
            try { root = window.MtV3Xml.rootName(xml); } catch (e) { return null; }
            return this.list().find(type => type.matches(root)) || null;
        },
    };
})();
