const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

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
