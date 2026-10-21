/* eslint-disable no-await-in-loop -- Each persistence assertion precedes the next mutation. */
import assert from 'assert';
import { JSDOM } from 'jsdom';
import supertest from 'supertest';
import { assignmentKey, assignmentQuery, matchAssignment } from '@hydrooj/common';
import * as document from '../packages/hydrooj/src/model/document';
import {
    ContestModel, DiscussionModel, DomainModel, ObjectId, PERM, PRIV, ProblemModel, TokenModel, UserModel,
} from '../packages/hydrooj/src/plugin-api';

// The application test runner supplies an isolated Mongo database.
export default async function assignmentRegression(server) {
    const domainId = 'assignment-regression';
    const member = 2502;
    const uid = 2501;
    const normalMember = 2503;
    const owner = 2504;
    for (const id of [member, uid, normalMember, owner]) {
        await UserModel.create(`assignment-${id}@example.invalid`, `assignment-${id}`, 'test-only', id, '127.0.0.1', PRIV.PRIV_USER_PROFILE);
    }
    await DomainModel.add(domainId, owner, 'Assignment regression', '');
    const sessions = {};
    for (const id of [member, uid, normalMember, owner]) {
        if (id !== owner) await DomainModel.setUserRole(domainId, id, 'default', true);
        [sessions[id]] = await TokenModel.add(TokenModel.TYPE_SESSION, 3600, { uid: id, scope: PERM.PERM_ALL.toString() });
    }
    const pid = await ProblemModel.add(domainId, 'P1', 'Assignment problem', 'Statement', owner);
    const request = (id: number, url: string, body?: object) => (body
        ? supertest(server).post(url).type('form').send(body) : supertest(server).get(url))
        .set('Authorization', `Bearer ${sessions[id]}`).set('Accept', 'application/json');
    await UserModel.updateGroup(domainId, String(uid), [member]);
    await UserModel.updateGroup(domainId, 'class-A', [normalMember]);
    const unusualNames = ['02501', 'user:2501', 'group:2501', 'legacy:2501', '\uE000user:2501', 'class,A', '班级'];
    for (const name of unusualNames) await UserModel.updateGroup(domainId, name, [normalMember]);
    const keys = {};
    for (const id of [member, uid, normalMember]) keys[id] = (await UserModel.getById(domainId, id)).assignmentKeys;
    const group = assignmentKey('group', uid);
    const user = assignmentKey('user', uid);
    for (const rule of ['acm', 'homework']) {
        const tid = await ContestModel.add(domainId, 'assignment regression', '', 1, rule,
            new Date(Date.now() - 1000), new Date(Date.now() + 3600000), [], false,
            { penaltySince: new Date(Date.now() + 1800000), penaltyRules: {} });
        // Seed an actual historical document, without rewriting it through the new model.
        await document.set(domainId, document.TYPE_CONTEST, tid, { assign: [String(uid)] });
        let doc = await ContestModel.get(domainId, tid);
        assert(!Object.hasOwn(doc, 'assignTyped'));
        assert.deepEqual((await UserModel.getById(domainId, member)).group, [String(uid), String(member)]);
        for (const id of [member, uid]) {
            assert(matchAssignment(doc, keys[id]));
            assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[id]) }).count(), 1);
            const legacyVnodes = await DiscussionModel.getListVnodes(domainId,
                [{ parentType: document.TYPE_CONTEST, parentId: tid }], false, keys[id].legacy);
            assert(legacyVnodes[document.TYPE_CONTEST][tid.toString()]);
        }
        for (const [selection, allowed, denied] of [
            [[group], [member], [uid, normalMember]],
            [[user], [uid], [member, normalMember]],
            [[user, group], [member, uid], [normalMember]],
            [[assignmentKey('group', 'class-A')], [normalMember], [member, uid]],
            ...unusualNames.map((name): [string[], number[], number[]] => [[assignmentKey('group', name)], [normalMember], [member, uid]]),
            [[], [member, uid, normalMember], []],
        ] as [string[], number[], number[]][]) {
            await ContestModel.edit(domainId, tid, { assignTyped: selection });
            doc = await ContestModel.get(domainId, tid);
            assert.deepEqual(doc.assignTyped, selection);

            const vnodes = (id: number) => DiscussionModel.getListVnodes(domainId,
                [{ parentType: document.TYPE_CONTEST, parentId: tid }], false, keys[id]);
            // A string[] cannot identify user/group membership for explicit assignments.
            const legacyVnodes = await DiscussionModel.getListVnodes(domainId,
                [{ parentType: document.TYPE_CONTEST, parentId: tid }], false, keys[member].legacy);
            assert.equal(!!legacyVnodes[document.TYPE_CONTEST][tid.toString()], !selection.length);
            for (const id of allowed) {
                assert((await vnodes(id))[document.TYPE_CONTEST][tid.toString()]);
                assert(matchAssignment(doc, keys[id]));
                assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[id]) }).count(), 1);
                // Simulate the old release using only legacy strings.
                assert(!doc.assign.length || doc.assign.some((key) => keys[id].legacy.includes(key)));
            }
            for (const id of denied) {
                assert(!(await vnodes(id))[document.TYPE_CONTEST][tid.toString()]);
                assert(!matchAssignment(doc, keys[id]));
                assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[id]) }).count(), 0);
            }
        }
        // Public legacy projection must not override a restrictive typed sidecar.
        await document.set(domainId, document.TYPE_CONTEST, tid, { assign: [], assignTyped: [group] });
        assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[uid]) }).count(), 0);
        // Unrelated edits preserve identity; clearing assignments clears both fields.
        await ContestModel.edit(domainId, tid, { title: 'edited' });
        assert.deepEqual((await ContestModel.get(domainId, tid)).assignTyped, [group]);
        await ContestModel.edit(domainId, tid, { assign: [] });
        assert.deepEqual((await ContestModel.get(domainId, tid)).assignTyped, []);
        // Empty typed selections override stale legacy values, including on model writes.
        await document.set(domainId, document.TYPE_CONTEST, tid, { assign: [String(uid)], assignTyped: [] });
        assert(matchAssignment(await ContestModel.get(domainId, tid), keys[normalMember]));
        assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[normalMember]) }).count(), 1);
        await ContestModel.edit(domainId, tid, { assign: [String(uid)], assignTyped: [] });
        assert.deepEqual((await ContestModel.get(domainId, tid)).assign, []);
        // Legacy API writes treat prefix-shaped names literally, never as encoded users.
        await ContestModel.edit(domainId, tid, { assign: ['user:2501'] });
        doc = await ContestModel.get(domainId, tid);
        assert(matchAssignment(doc, keys[normalMember]));
        assert(!matchAssignment(doc, keys[uid]));
        assert.deepEqual(doc.assignTyped, ['legacy:user%3A2501']);
        // Null has the same fallback semantics in detail checks and Mongo queries.
        await document.set(domainId, document.TYPE_CONTEST, tid, { assign: [String(uid)], assignTyped: null });
        assert(matchAssignment(await ContestModel.get(domainId, tid), keys[uid]));
        assert.equal(await ContestModel.getMulti(domainId, { docId: tid, ...assignmentQuery(keys[uid]) }).count(), 1);
        // Submit the actual form, reopen the editor, and exercise HTTP visibility.
        const kind = rule === 'homework' ? 'homework' : 'contest';
        const base = `/d/${domainId}/${kind}`;
        const form = {
            operation: 'update', title: 'HTTP assignment regression', content: 'Statement', pids: String(pid), rule,
            beginAtDate: '2030-01-01', beginAtTime: '10:00', duration: '2',
            penaltySinceDate: '2030-01-02', penaltySinceTime: '10:00', extensionDays: '1', penaltyRules: '{}',
        };
        const creation = await request(owner, `${base}/create`, { ...form, assignTyped: group });
        assert.equal(creation.status, 200, JSON.stringify(creation.body));
        const httpTid = new ObjectId(creation.body.tid);
        const editUrl = `${base}/${httpTid}/edit`;
        for (const [selection, allowed, denied] of [
            [[group], [member], [uid, normalMember]],
            [[user], [uid], [member, normalMember]],
            [[group, user], [member, uid], [normalMember]],
            [[], [member, uid, normalMember], []],
        ] as [string[], number[], number[]][]) {
            const saved = await request(owner, editUrl, { ...form, assign: String(uid), assignTyped: selection.join(',') });
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            assert.deepEqual((await ContestModel.get(domainId, httpTid)).assignTyped, selection);
            const editor = await request(owner, editUrl);
            assert.equal(editor.status, 200);
            assert.deepEqual(editor.body.assignTyped, selection);
            const html = await supertest(server).get(editUrl).set('Authorization', `Bearer ${sessions[owner]}`).expect(200);
            const dom = new JSDOM(html.text);
            assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[name="assignTyped"]').value, selection.join(','));
            dom.window.close();
            for (const id of allowed) {
                assert.equal((await request(id, `${base}/${httpTid}`)).status, 200);
                const list = await request(id, base);
                assert.equal(list.status, 200, JSON.stringify(list.body));
                assert(list.body.tdocs.some((tdoc) => tdoc.docId === httpTid.toString()));
            }
            for (const id of denied) {
                assert.equal((await request(id, `${base}/${httpTid}`)).status, 403);
                const list = await request(id, base);
                assert.equal(list.status, 200, JSON.stringify(list.body));
                assert(!list.body.tdocs.some((tdoc) => tdoc.docId === httpTid.toString()));
            }
        }
        // Creation uses the same dual-write boundary as edit/API calls.
        const created = await ContestModel.add(domainId, 'typed creation', '', 1, rule,
            new Date(Date.now() - 1000), new Date(Date.now() + 3600000), [], false,
            { assignTyped: [group, user], penaltySince: new Date(Date.now() + 1800000), penaltyRules: {} });
        assert.deepEqual((await ContestModel.get(domainId, created)).assignTyped, [group, user]);
        assert.deepEqual((await ContestModel.get(domainId, created)).assign, [String(uid)]);
    }
}
