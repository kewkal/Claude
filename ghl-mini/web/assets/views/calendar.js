import {
  api, h, raw, stat, pill, guard, ok, err, modal, confirmDialog,
  formData, fmtDateTime, fmtTime, fmtDate, emptyState, titleCase, toDate,
} from '../ui.js';

let cursor = new Date();
cursor.setDate(1);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default {
  async render(root, ctx) {
    ctx.setActions(h`
      <a class="btn" href="/book" target="_blank">Public booking page</a>
      <a class="btn" href="/api/calendar.ics" download>Export .ics</a>
      <button class="btn" id="hoursBtn">Hours</button>
      <button class="btn primary" id="newBookingBtn">New booking</button>
    `);
    document.getElementById('newBookingBtn').onclick = () => bookingModal(null, () => reload(root, ctx));
    document.getElementById('hoursBtn').onclick = () => hoursModal(() => reload(root, ctx));
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const [data, stats] = await Promise.all([
    api.get('/api/bookings'),
    api.get('/api/bookings/stats'),
  ]);
  root.innerHTML = layout(data.bookings, stats);
  wire(root, ctx, data.bookings);
}

function layout(bookings, stats) {
  const upcoming = bookings
    .filter((b) => toDate(b.starts_at) > new Date() && b.status !== 'cancelled')
    .slice(0, 10);

  return h`
    <div class="grid cols-4" style="margin-bottom:14px">
      ${raw(stat('Today', stats.today, 'on the calendar', stats.today ? 'accent' : ''))}
      ${raw(stat('Next 7 days', stats.this_week, 'booked in', 'ok'))}
      ${raw(stat('No-shows', stats.no_shows, 'all time', stats.no_shows ? 'warn' : ''))}
      ${raw(stat('Total booked', stats.total, 'since you started'))}
    </div>

    <div class="grid sidebar-split">
      <div class="card">
        <div class="bar">
          <h2 style="margin:0">${cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
          <div style="display:flex;gap:6px">
            <button class="btn sm" id="prevMonth">←</button>
            <button class="btn sm" id="thisMonth">Today</button>
            <button class="btn sm" id="nextMonth">→</button>
          </div>
        </div>
        ${raw(monthGrid(bookings))}
      </div>

      <div class="card">
        <h2>Coming up</h2>
        <div class="list" style="margin-top:10px">
          ${raw(upcoming.length
            ? upcoming.map((b) => h`<div class="list-item" data-booking="${b.id}" style="cursor:pointer">
                <div class="grow">
                  <div class="t">${b.name}</div>
                  <div class="s">${fmtDateTime(b.starts_at)} · ${b.title}</div>
                  ${raw(b.lead_phone ? h`<div class="s mono">${b.lead_phone}</div>` : '')}
                </div>
                ${raw(pill(b.status))}
              </div>`).join('')
            : '<div class="dim" style="padding:8px 2px">Nothing booked. Go make some calls.</div>')}
        </div>
      </div>
    </div>
  `;
}

function monthGrid(bookings) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysPrev = new Date(year, month, 0).getDate();
  const todayKey = new Date().toDateString();

  const byDay = {};
  for (const b of bookings) {
    const d = toDate(b.starts_at);
    if (!d) continue;
    (byDay[d.toDateString()] ||= []).push(b);
  }

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, daysPrev - i), other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), other: false });
  while (cells.length % 7 !== 0) cells.push({ date: new Date(year, month + 1, cells.length - startDow - daysInMonth + 1), other: true });

  return h`<div class="cal">
    ${raw(DOW.map((d) => h`<div class="dow">${d}</div>`).join(''))}
    ${raw(cells.map(({ date, other }) => {
      const events = byDay[date.toDateString()] || [];
      return h`<div class="day ${raw(other ? 'other' : '')} ${raw(date.toDateString() === todayKey ? 'today' : '')}">
        <div class="n">${date.getDate()}</div>
        ${raw(events.slice(0, 3).map((b) => h`<div class="ev ${raw(b.status)}" data-booking="${b.id}" title="${b.name} — ${fmtTime(b.starts_at)}">${fmtTime(b.starts_at)} ${b.name}</div>`).join(''))}
        ${raw(events.length > 3 ? h`<div class="s dim">+${events.length - 3} more</div>` : '')}
      </div>`;
    }).join(''))}
  </div>`;
}

function wire(root, ctx, bookings) {
  root.querySelector('#prevMonth').onclick = () => { cursor.setMonth(cursor.getMonth() - 1); reload(root, ctx); };
  root.querySelector('#nextMonth').onclick = () => { cursor.setMonth(cursor.getMonth() + 1); reload(root, ctx); };
  root.querySelector('#thisMonth').onclick = () => { cursor = new Date(); cursor.setDate(1); reload(root, ctx); };

  root.querySelectorAll('[data-booking]').forEach((el) => {
    el.onclick = () => {
      const b = bookings.find((x) => x.id === Number(el.dataset.booking));
      if (b) bookingModal(b, () => reload(root, ctx));
    };
  });
}

function bookingModal(booking, onDone) {
  modal((card, close) => {
    const start = booking ? toDate(booking.starts_at) : (() => {
      const d = new Date(Date.now() + 864e5);
      d.setMinutes(0, 0, 0);
      return d;
    })();
    const localValue = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const statuses = ['confirmed', 'tentative', 'completed', 'no_show', 'cancelled'];

    card.innerHTML = h`
      <div class="modal-head"><h2>${booking ? 'Edit booking' : 'New booking'}</h2><button class="icon-btn" data-close>×</button></div>
      <form id="bookForm">
        <div class="inline">
          <label class="field"><span>Name</span><input name="name" value="${booking?.name || ''}" required></label>
          <label class="field"><span>Title</span><input name="title" value="${booking?.title || 'Discovery call'}"></label>
        </div>
        <div class="inline">
          <label class="field"><span>Email</span><input type="email" name="email" value="${booking?.email || ''}"></label>
          <label class="field"><span>Phone</span><input name="phone" value="${booking?.phone || ''}"></label>
        </div>
        <div class="inline">
          <label class="field"><span>When</span><input type="datetime-local" name="starts_at" value="${localValue}" required></label>
          <label class="field"><span>Minutes</span><input type="number" name="duration_min" value="30"></label>
          ${raw(booking ? h`<label class="field"><span>Status</span><select name="status">
            ${raw(statuses.map((s) => h`<option value="${s}" ${raw(booking.status === s ? 'selected' : '')}>${titleCase(s)}</option>`).join(''))}
          </select></label>` : '')}
        </div>
        <label class="field"><span>Notes</span><textarea name="notes">${booking?.notes || ''}</textarea></label>
        ${raw(booking ? '' : '<label class="field"><input type="checkbox" name="notify" checked> Email them a confirmation</label>')}
        <div class="modal-foot">
          ${raw(booking ? '<button type="button" class="btn danger" data-del>Delete</button>' : '')}
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-del]')?.addEventListener('click', () =>
      confirmDialog('Delete this booking?', async () => {
        await api.del(`/api/bookings/${booking.id}`);
        ok('Deleted');
        close();
        onDone();
      }));

    card.querySelector('#bookForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      const payload = {
        name: v.name, title: v.title, email: v.email, phone: v.phone,
        starts_at: new Date(v.starts_at).toISOString(),
        duration_min: v.duration_min, notes: v.notes, notify: v.notify,
      };
      if (booking) {
        const end = new Date(new Date(v.starts_at).getTime() + (Number(v.duration_min) || 30) * 60000);
        await api.patch(`/api/bookings/${booking.id}`, {
          ...payload, status: v.status, ends_at: end.toISOString(),
        });
      } else {
        await api.post('/api/bookings', payload);
      }
      ok('Saved');
      close();
      onDone();
    });
  });
}

function hoursModal(onDone) {
  modal(async (card, close) => {
    card.innerHTML = '<div class="loading">Loading…</div>';
    const { availability } = await api.get('/api/availability');
    const byDay = {};
    for (const r of availability) byDay[r.weekday] = r;

    card.innerHTML = h`
      <div class="modal-head"><h2>Booking hours</h2><button class="icon-btn" data-close>×</button></div>
      <p class="muted" style="margin-top:0">These are the slots your public booking page offers. Times are UTC.</p>
      <div id="rows">
        ${raw(DAY_NAMES.map((name, i) => {
          const r = byDay[i];
          return h`<div class="inline" style="margin-bottom:9px" data-day="${i}">
            <label class="field" style="flex:0 0 130px">
              <input type="checkbox" data-active ${raw(r ? 'checked' : '')}> ${name}
            </label>
            <label class="field"><span>From</span><input type="time" data-start value="${r ? minToTime(r.start_min) : '09:00'}"></label>
            <label class="field"><span>To</span><input type="time" data-end value="${r ? minToTime(r.end_min) : '17:00'}"></label>
            <label class="field"><span>Slot</span><select data-slot>
              ${raw([15, 20, 30, 45, 60].map((m) => h`<option value="${m}" ${raw((r?.slot_min || 30) === m ? 'selected' : '')}>${m} min</option>`).join(''))}
            </select></label>
          </div>`;
        }).join(''))}
      </div>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-save>Save hours</button>
      </div>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-save]').onclick = guard(async () => {
      const rules = [];
      card.querySelectorAll('[data-day]').forEach((row) => {
        if (!row.querySelector('[data-active]').checked) return;
        rules.push({
          weekday: Number(row.dataset.day),
          start_min: timeToMin(row.querySelector('[data-start]').value),
          end_min: timeToMin(row.querySelector('[data-end]').value),
          slot_min: Number(row.querySelector('[data-slot]').value),
        });
      });
      await api.put('/api/availability', { availability: rules });
      ok('Hours saved');
      close();
      onDone();
    });
  });
}

const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMin = (t) => {
  const [hh, mm] = String(t || '0:0').split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
};
