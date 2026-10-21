import { assignmentKey, parseAssignmentKey } from '@hydrooj/common';
import { AutoComplete, AutoCompleteHandle, AutoCompleteProps } from '@hydrooj/components';
import type { GDoc, Udoc } from 'hydrooj/src/interface';
import PropTypes from 'prop-types';
import React, { forwardRef } from 'react';
import { api } from 'vj/utils';

interface AssignItem {
  type: 'user' | 'group' | 'legacy';
  key: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  uids?: number[];
  invalid?: boolean;
}

const toUserItem = (user: Udoc): AssignItem => ({
  type: 'user',
  key: assignmentKey('user', user._id),
  name: user.uname,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
});

const toGroupItem = (group: GDoc): AssignItem => ({
  type: 'group',
  key: assignmentKey('group', group.name),
  name: group.name,
  uids: group.uids,
});

const AssignSelectAutoComplete = forwardRef<AutoCompleteHandle<AssignItem>, AutoCompleteProps<AssignItem>>((props, ref) => (
  <AutoComplete<AssignItem>
    ref={ref as any}
    cacheKey="assign"
    fetchPastedItems={async (inputs) => {
      const userIds = inputs.filter((input) => /^-?\d+$/.test(input)).map(Number);
      const [users, groups]: [Udoc[], GDoc[]] = await Promise.all([
        userIds.length ? api('users', { ids: userIds }, ['_id', 'uname', 'displayName']) : [],
        api('groups', { names: inputs }, ['name', 'uids']),
      ]);
      return inputs.map((input) => {
        const group = groups.find((g) => g.name === input);
        const user = /^-?\d+$/.test(input) && users.find((u) => u._id === +input);
        if (group && user) throw new Error(`Multiple matches for "${input}". Select a user or group from the suggestions.`);
        if (group) return toGroupItem(group);
        if (user) return toUserItem(user);
        throw new Error(`No user or group found for "${input}". Check the pasted text and try again.`);
      });
    }}
    queryItems={async (query) => {
      const [users, groups] = await Promise.all([
        api('users', { search: query }, ['_id', 'uname', 'displayName', 'avatarUrl']),
        api('groups', { search: query }, ['name', 'uids']),
      ]);
      const userItems: AssignItem[] = users.map((user: Udoc) => toUserItem(user));
      const groupItems: AssignItem[] = groups.map((group: GDoc) => toGroupItem(group));
      return [...groupItems, ...userItems];
    }}
    fetchItems={async (keys) => {
      const targets = keys.map(parseAssignmentKey);
      const userIds = targets.filter((item) => item.type === 'user').map((item) => item.id);
      const groupNames = targets.filter((item) => item.type === 'group').map((item) => item.id);
      const [users, groups]: [Udoc[], GDoc[]] = await Promise.all([
        userIds.length > 0 ? api('users', { auto: userIds }, ['_id', 'uname', 'displayName']) : [],
        groupNames.length > 0 ? api('groups', { names: groupNames }, ['name', 'uids']) : [],
      ]);
      const userItems = users.map(toUserItem);
      const groupItems: AssignItem[] = groupNames.map((name) => {
        const group = groups.find((g) => g.name === name);
        return group ? toGroupItem(group) : { type: 'group', key: assignmentKey('group', name), name, invalid: true };
      });

      return [...groupItems, ...userItems, ...targets.filter((item) => item.type === 'legacy')
        .map((item): AssignItem => ({ type: 'legacy', key: assignmentKey('legacy', item.id), name: item.id }))];
    }}
    itemText={(item) => {
      if (item.type === 'legacy') return `${item.name} (legacy assignment)`;
      if (item.type === 'group') {
        if (item.invalid) return `${item.name} (invalid)`;
        return `${item.name} (${item.uids?.length || 0} users)`;
      }
      return item.name + (item.displayName ? ` (${item.displayName})` : '');
    }}
    itemKey={(item) => item.key}
    renderItem={(item) => (
      <div className="media">
        {item.type === 'user' && (
          <div className="media__left medium">
            <img className="small user-profile-avatar" alt="" src={item.avatarUrl} width="30" height="30" />
          </div>
        )}
        <div className="media__body medium">
          <div className="assign-select__name">
            {item.name}{item.type === 'user' && item.displayName && ` (${item.displayName})`}
          </div>
          <div className="assign-select__desc">
            {item.type === 'legacy' ? 'Legacy assignment (user or group)'
              : item.type === 'group' ? `Group • ${item.uids?.length || 0} users`
                : `User • UID = ${parseAssignmentKey(item.key).id}`}
          </div>
        </div>
      </div>
    )}
    {...{
      width: '100%',
      height: 'auto',
      listStyle: {},
      multi: true,
      selectedKeys: [],
      allowEmptyQuery: false,
      freeSolo: false,
      freeSoloConverter: (input) => input,
      ...props,
    }}
  />
));

AssignSelectAutoComplete.propTypes = {
  width: PropTypes.string,
  height: PropTypes.string,
  listStyle: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  multi: PropTypes.bool,
  selectedKeys: PropTypes.arrayOf(PropTypes.string),
  allowEmptyQuery: PropTypes.bool,
  freeSolo: PropTypes.bool,
  freeSoloConverter: PropTypes.func,
};

AssignSelectAutoComplete.displayName = 'AssignSelectAutoComplete';

export default AssignSelectAutoComplete;
