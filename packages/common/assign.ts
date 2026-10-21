export interface AssignmentTarget { type: 'user' | 'group' | 'legacy', id: string }
export interface Assignments { assign?: string[], assignTyped?: string[] }
export interface AssignmentKeys { legacy: string[], typed: string[] }

// Every value in the typed field is encoded, including preserved legacy values.
// The separate field keeps arbitrary historical group names out of this namespace.
export function assignmentKey(type: AssignmentTarget['type'], id: string | number) {
    return `${type}:${encodeURIComponent(id.toString())}`;
}

export function parseAssignmentKey(key: string): AssignmentTarget {
    const match = /^(user|group|legacy):(.*)$/.exec(key);
    if (!match) throw new Error('Invalid assignment key');
    return { type: match[1] as AssignmentTarget['type'], id: decodeURIComponent(match[2]) };
}

export function groupAssignmentKeys(groups: { name: string, assignmentUser?: boolean }[]): AssignmentKeys {
    return {
        legacy: groups.map((group) => group.name),
        typed: groups.flatMap((group) => [
            assignmentKey('legacy', group.name),
            assignmentKey(group.assignmentUser ? 'user' : 'group', group.name),
        ]),
    };
}

export function effectiveAssignments(doc: Assignments = {}) {
    return doc?.assignTyped ?? (doc?.assign || []).map((key) => assignmentKey('legacy', key));
}

export function matchAssignment(doc: Assignments, keys: AssignmentKeys) {
    const assignments = effectiveAssignments(doc);
    return !assignments.length || assignments.some((key) => keys.typed.includes(key));
}

export function normalizeAssignments(doc: Assignments): Assignments {
    const assignTyped = [...new Set(effectiveAssignments(doc))];
    return { assign: [...new Set(assignTyped.map((key) => parseAssignmentKey(key).id))], assignTyped };
}

// null and missing both denote legacy documents; an empty typed array is authoritative.
export function assignmentQuery(keys: AssignmentKeys, includePublic = true) {
    const condition = (field: string, values: string[]) => ({ $or: [
        { [field]: { $in: values } },
        ...includePublic ? [{ [field]: { $size: 0 } }] : [],
    ] });
    return { $or: [
        { assignTyped: { $ne: null }, ...condition('assignTyped', keys.typed) },
        { assignTyped: null, ...condition('assign', keys.legacy) },
    ] };
}
