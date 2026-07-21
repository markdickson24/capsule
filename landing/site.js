const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

const wl = document.getElementById('waitlist');
const wlMsg = document.getElementById('waitlist-msg');
if (wl) {
  wl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = wl.querySelector('button');
    const label = btn.textContent;
    wlMsg.className = 'cta-msg'; wlMsg.textContent = '';
    btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const res = await fetch(wl.action, { method: 'POST', body: new FormData(wl), headers: { Accept: 'application/json' } });
      if (res.ok) {
        wl.reset();
        wlMsg.textContent = "You're on the list — we'll be in touch.";
        wlMsg.classList.add('ok');
      } else {
        const j = await res.json().catch(() => ({}));
        wlMsg.textContent = (j.errors && j.errors[0] && j.errors[0].message) || 'Something went wrong — try again.';
        wlMsg.classList.add('err');
      }
    } catch { wlMsg.textContent = 'Network error — try again.'; wlMsg.classList.add('err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
}

const params = new URLSearchParams(window.location.search);
const invitedBy = params.get('invited_by');
if (invitedBy) {
  const banner = document.getElementById('invite-banner');
  const title = document.getElementById('invite-banner-title');
  if (banner && title) {
    const capsuleName = params.get('capsule');
    title.textContent = capsuleName
      ? `${invitedBy} invited you to "${capsuleName}"`
      : `${invitedBy} invited you to a Capsule`;
    banner.style.display = 'flex';
  }
}
