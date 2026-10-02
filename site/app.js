const API_URL = 'https://n8n.lab.vn.ua/webhook/lab-status';

const KIND_LABEL = { vm: 'VM', lxc: 'LXC' };
const STATE_NOTE = { down: 'down', stopped: 'stopped', unknown: 'no data' };

const verdict = document.getElementById('verdict');
const details = document.getElementById('details');
const again = document.getElementById('again');
const rack = document.getElementById('rack');

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const childrenOf = (item) => item.children ?? [];
const weightOf = (item) => 1 + childrenOf(item).reduce((sum, child) => sum + weightOf(child), 0);
const hasDown = (item) => item.state === 'down' || childrenOf(item).some(hasDown);

const flatten = (items) => items.flatMap((item) => [item, ...flatten(childrenOf(item))]);

// A name is a link when the object has a web interface.
const nameOf = (item, tag) => {
  if (!item.url) return el(tag, 'name', item.name);
  const heading = el(tag, 'name');
  const link = el('a', 'link', item.name);
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  heading.append(link);
  return heading;
};

const headOf = (item, tag) => {
  const head = el('div', 'head');
  head.append(nameOf(item, tag));
  if (KIND_LABEL[item.kind]) head.append(el('span', 'kind', KIND_LABEL[item.kind]));
  if (STATE_NOTE[item.state]) head.append(el('span', 'note', STATE_NOTE[item.state]));
  return head;
};

const container = (item) => {
  const tile = el(item.url ? 'a' : 'div', `tile ctr state-${item.state}`);
  if (item.url) {
    tile.href = item.url;
    tile.target = '_blank';
    tile.rel = 'noreferrer';
  }
  tile.title = item.name;
  tile.append(el('span', 'name', item.name));
  if (STATE_NOTE[item.state]) tile.append(el('span', 'note', STATE_NOTE[item.state]));
  return tile;
};

// Containers of one stack sit together inside a labelled outline.
const containersOf = (items) => {
  const box = el('div', 'containers');
  const stacks = new Map();
  const loose = [];
  for (const item of items) {
    if (!item.stack) loose.push(item);
    else stacks.set(item.stack, [...(stacks.get(item.stack) ?? []), item]);
  }
  for (const name of [...stacks.keys()].sort()) {
    const members = stacks.get(name);
    const group = el('div', 'stack');
    group.style.flex = `${members.length} 1 ${members.length * 150}px`;
    group.append(el('span', 'stack-name', name));
    const row = el('div', 'containers');
    row.append(...members.map(container));
    group.append(row);
    box.append(group);
  }
  box.append(...loose.map(container));
  return box;
};

const guest = (item) => {
  const kids = childrenOf(item);
  const tile = el('section', `tile guest state-${item.state}`);
  if (hasDown(item) && item.state !== 'down') tile.classList.add('has-down');
  tile.style.flex = `${weightOf(item)} 1 ${170 + kids.length * 95}px`;
  tile.append(headOf(item, 'h3'));
  if (kids.length) tile.append(containersOf(kids));
  return tile;
};

const node = (item) => {
  const weight = weightOf(item);
  const tile = el('section', `tile node state-${item.state}`);
  if (hasDown(item) && item.state !== 'down') tile.classList.add('has-down');
  tile.style.flex = `${weight} 1 ${Math.min(260 + weight * 55, 900)}px`;
  tile.append(headOf(item, 'h2'));
  const kids = childrenOf(item);
  if (kids.length) {
    const guests = el('div', 'guests');
    guests.append(...kids.map(guest));
    tile.append(guests);
  }
  return tile;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const summarise = (data, seconds) => {
  const all = flatten(data.nodes);
  const count = (state) => all.filter((item) => item.state === state).length;
  const down = all.filter((item) => item.state === 'down');
  const checked = count('up') + down.length;

  document.body.classList.toggle('alarm', down.length > 0);
  verdict.textContent = down.length
    ? `${down.length} down: ${down.map((item) => item.name).join(', ')}.`
    : `All ${plural(checked, 'checked object')} are up.`;

  const notes = [];
  if (count('stopped')) notes.push(`${count('stopped')} stopped on purpose`);
  if (count('unknown')) notes.push(`${count('unknown')} without status data`);
  const time = new Date(data.generated).toLocaleTimeString([], { hour12: false });
  const lead = notes.length ? `${notes.join(', ')}. ` : '';
  details.textContent = `${lead}Checked at ${time} in ${seconds.toFixed(1)} s.`;
};

const load = async () => {
  again.hidden = true;
  document.body.classList.remove('alarm', 'failed');
  verdict.textContent = 'Checking services…';
  details.textContent = '';
  const started = performance.now();
  try {
    const response = await fetch(API_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`n8n answered ${response.status}`);
    const data = await response.json();
    const nodes = [...data.nodes].sort((a, b) => weightOf(b) - weightOf(a) || a.name.localeCompare(b.name));
    rack.replaceChildren(...nodes.map(node));
    summarise(data, (performance.now() - started) / 1000);
  } catch (error) {
    document.body.classList.add('failed');
    rack.replaceChildren();
    verdict.textContent = 'Status could not be loaded.';
    details.textContent = `${error.message}. n8n or NetBox may be unreachable.`;
  }
  again.hidden = false;
};

again.addEventListener('click', load);
load();
