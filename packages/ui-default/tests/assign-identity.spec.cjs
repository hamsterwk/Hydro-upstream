/* eslint-disable no-await-in-loop -- Each UI selection must settle before the next one. */
// Run with: node --test packages/ui-default/tests/assign-identity.spec.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

test('selected user and group identities survive cache, form transport and editing', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-assign-test-'));
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
    const oldGlobals = new Map();
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent']) {
        oldGlobals.set(key, Object.getOwnPropertyDescriptor(global, key));
        Object.defineProperty(global, key, { value: dom.window[key], configurable: true });
    }
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const React = require('react');
    const { createRoot } = require('react-dom/client');
    const { act } = React;
    const users = [{ _id: 2501, uname: 'student2501' }, { _id: -2501, uname: 'negative-user' }, { _id: 2502, uname: 'student2502' }];
    const groups = [
        '2501', 'class-A', 'class-B', '-2501', '02501', 'user:2501', 'group:2501', 'legacy:2501', '\uE000user:2501', 'class,A', '班级',
    ].map((name) => ({ name, uids: [42] }));
    const requests = [];
    global.__assignmentApi = async (entity, args) => {
        requests.push({ entity, args });
        if (entity === 'users') {
            if (args.ids) return users.filter((u) => args.ids.includes(u._id));
            return args.auto ? users.filter((u) => args.auto.includes(String(u._id))) : users;
        }
        return args.names ? groups.filter((g) => args.names.includes(g.name)) : groups;
    };
    let root;
    try {
        const output = path.join(temp, 'component.cjs');
        await esbuild.build({
            stdin: { contents: [
                'export {default as Component} from \'./packages/ui-default/components/autocomplete/components/AssignSelectAutoComplete\';',
                'export {Types} from \'./framework/framework/validator\';',
                'export {AutoComplete} from \'@hydrooj/components\';',
            ].join('\n'),
            resolveDir: process.cwd(), loader: 'tsx' },
            outfile: output, bundle: true, platform: 'node', format: 'cjs',
            external: ['react', 'react-dom', 'jsdom'], loader: { '.scss': 'empty' },
            plugins: [{ name: 'test-api', setup(build) {
                build.onResolve({ filter: /^vj\/utils$/ }, () => ({ path: 'api', namespace: 'fixture' }));
                build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                    contents: 'export const api = (...args) => globalThis.__assignmentApi(...args);',
                }));
                build.onResolve({ filter: /^@hydrooj\/components$/ }, () => ({ path: 'autocomplete', namespace: 'real-component' }));
                build.onLoad({ filter: /.*/, namespace: 'real-component' }, () => ({
                    contents: `export {default as AutoComplete} from ${JSON.stringify(
                        path.resolve('packages/components/frontend/autocomplete/AutoComplete.tsx'),
                    )};`,
                    resolveDir: process.cwd(),
                }));
            } }],
        });
        // Bundle lives outside node_modules: resolve the workspace's React singleton.
        const Module = require('node:module');
        const bundledModule = new Module(output, module);
        bundledModule.filename = output;
        bundledModule.paths = Module._nodeModulePaths(process.cwd());
        bundledModule._compile(fs.readFileSync(output, 'utf8'), output);
        const {
            Component, Types, AutoComplete,
        } = bundledModule.exports;
        assert.equal(Types.Name[1]('2501'), true);
        const assignmentKey = (type, id) => `${type}:${encodeURIComponent(id)}`;
        const ref = React.createRef();
        let serialized = '';
        root = createRoot(document.getElementById('root'));
        await act(async () => root.render(React.createElement(Component, { ref, onChange: (v) => { serialized = v; } })));
        const input = document.querySelector('input');
        const query = async () => {
            await act(async () => {
                input.focus();
                ref.current.setQuery('2501');
                await ref.current.triggerQuery();
                await new Promise((resolve) => setTimeout(resolve, 350));
            });
        };
        const paste = async (text) => {
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
            await act(async () => {
                document.querySelector('input').dispatchEvent(event);
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
            assert.equal(event.defaultPrevented, true);
        };
        await paste('class-A,class-B');
        assert.deepEqual(ref.current.getSelectedItems().map((item) => item.name), ['class-A', 'class-B']);
        await paste('class-A，class-B');
        assert.deepEqual(ref.current.getSelectedItems().map((item) => item.name), ['class-A', 'class-B']);
        await act(async () => ref.current.clear());
        await paste('user:2501,2502');
        assert.deepEqual(ref.current.getSelectedItems().map((item) => item.type), ['group', 'user']);
        assert.equal(serialized, 'group:user%3A2501,user:2502');
        const selectedBeforeFailure = serialized;
        // Rejected batches retain the input, explain why, and prevent accidental form submission.
        for (const text of ['class-A,2501', 'class-A，missing-group', '02501,class-A']) {
            await paste(text);
            assert.equal(serialized, selectedBeforeFailure);
            assert.equal(input.value, text);
            assert.equal(input.checkValidity(), false);
            assert.match(document.querySelector('[role="alert"]').textContent, /Multiple matches|No user or group/);
        }
        const api = global.__assignmentApi;
        global.__assignmentApi = async () => { throw new Error('Network unavailable'); };
        await paste('class-A,class-B');
        assert.equal(serialized, selectedBeforeFailure);
        assert.equal(input.value, 'class-A,class-B');
        assert.equal(document.querySelector('[role="alert"]').textContent, 'Network unavailable');
        global.__assignmentApi = api;
        await paste('class-A，class-B');
        assert.equal(input.checkValidity(), true);
        assert.equal(document.querySelector('[role="alert"]'), null);
        assert.equal(input.value, '');
        assert.equal(ref.current.getSelectedItems().length, 4);
        await act(async () => ref.current.clear());
        await query();
        const options = [...document.querySelectorAll('li')];
        assert.equal(options.length, groups.length + users.length);
        assert(options[0].textContent.includes('Group'));
        assert(options.at(-1).textContent.includes('User'));
        const select = async (label) => {
            await query();
            const option = [...document.querySelectorAll('li')].find((li) => li.textContent.includes(label));
            assert(option, label);
            await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        };
        const parseRequest = (value) => {
            // Same comma-separated string protocol used by contest edit; execute its real validator.
            const body = new URLSearchParams(new URLSearchParams({ assignTyped: value }).toString());
            return Types.CommaSeperatedArray(body.get('assignTyped'));
        };
        await select('2501Group');
        assert.equal(ref.current.getSelectedItems()[0].type, 'group');
        assert.deepEqual(ref.current.getSelectedItemKeys(), [assignmentKey('group', '2501')]);
        const groupRequest = parseRequest(serialized);
        assert.deepEqual(groupRequest, [assignmentKey('group', '2501')]);
        await select('student2501');
        assert.equal(ref.current.getSelectedItems()[1].type, 'user');
        const both = parseRequest(serialized);
        assert.deepEqual(both, [assignmentKey('group', '2501'), assignmentKey('user', '2501')]);
        for (const group of groups.slice(1)) {
            await select(`${group.name}Group`);
            assert(parseRequest(serialized).includes(assignmentKey('group', group.name)));
        }
        await select('negative-user');
        assert(parseRequest(serialized).includes('user:-2501'));
        const persisted = JSON.parse(JSON.stringify({ assignTyped: parseRequest(serialized) }));
        // Reopen persisted form: fetch-by-type must hydrate the same entities.
        await act(async () => root.unmount());
        root = createRoot(document.getElementById('root'));
        await act(async () => {
            root.render(React.createElement(Component, { ref, cacheKey: 'reopened', selectedKeys: persisted.assignTyped, onChange: () => {} }));
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        assert.deepEqual(ref.current.getSelectedItems().map((item) => item.type), ['group', 'user', ...groups.slice(1).map(() => 'group'), 'user']);
        assert(requests.some(({ entity, args }) => entity === 'groups' && args.names?.includes('02501')));
        assert(requests.some(({ entity, args }) => entity === 'users' && args.auto?.includes('-2501')));
        await act(async () => ref.current.clear());
        assert.deepEqual(ref.current.getSelectedItemKeys(), []);
        await act(async () => root.unmount());
        root = createRoot(document.getElementById('root'));
        await act(async () => {
            root.render(React.createElement(Component, { ref, selectedKeys: ['legacy:2501', 'legacy:user%3A2501'], onChange: () => {} }));
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        assert.deepEqual(ref.current.getSelectedItems().map((item) => item.type), ['legacy', 'legacy']);
        assert.deepEqual(ref.current.getSelectedItemKeys(), ['legacy:2501', 'legacy:user%3A2501']);
        // Existing autocomplete callers retain their original paste and validation behavior.
        await act(async () => root.unmount());
        root = createRoot(document.getElementById('root'));
        const fallbackRequests = [];
        await act(async () => {
            root.render(React.createElement(AutoComplete, {
                ref, multi: true, selectedKeys: ['existing'],
                fetchItems: async (keys) => {
                    fallbackRequests.push(keys);
                    if (keys.includes('missing')) throw new Error('Missing item');
                    return keys;
                },
            }));
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        fallbackRequests.length = 0;
        const fallbackInput = document.querySelector('input');
        fallbackInput.value = 'pending query';
        fallbackInput.setCustomValidity('Existing validation');
        await paste('existing, new ');
        assert.deepEqual(fallbackRequests, [[' new ']]);
        assert.equal(ref.current.getValue(), 'existing, new ');
        assert.equal(fallbackInput.value, 'pending query');
        assert.equal(fallbackInput.validationMessage, 'Existing validation');
        await paste('missing,existing');
        assert.deepEqual(fallbackRequests.at(-1), ['missing']);
        assert.equal(ref.current.getValue(), 'existing, new ');
        assert.equal(fallbackInput.value, 'pending query');
        assert.equal(fallbackInput.validationMessage, 'Existing validation');
        assert.equal(document.querySelector('[role="alert"]'), null);
    } finally {
        if (root) await act(async () => root.unmount());
        delete global.__assignmentApi;
        delete global.IS_REACT_ACT_ENVIRONMENT;
        dom.window.close();
        for (const [key, descriptor] of oldGlobals) {
            if (descriptor) Object.defineProperty(global, key, descriptor);
            else delete global[key];
        }
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
