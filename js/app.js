// main site script, pulls live numbers from roproxy

document.getElementById('year').textContent = new Date().getFullYear();

// preloader: logo builds itself out of pixels, then dissolves
(function(){
  const pre = document.getElementById('preload');
  const logo = PixelLogo(document.getElementById('preloadLogo'), 'assets/logo-color.png');
  const start = performance.now();
  let hidden = false;
  function hide(){
    if (hidden) return;
    hidden = true;
    const wait = Math.max(0, LOADER_MIN_MS - (performance.now() - start));
    setTimeout(() => {
      logo.dissolve();
      setTimeout(() => {
        pre.classList.add('done');
        document.body.classList.remove('loading');
        heroIn();
      }, 650);
    }, wait);
  }
  // don't hang if fonts/images are slow
  if (document.readyState === 'complete') hide();
  else addEventListener('load', hide);
  setTimeout(hide, 8000); // failsafe
})();

// nav bg on scroll
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 30), {passive:true});

// scroll reveal, dithered in
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const delayOf = el => el.classList.contains('d3') ? 240 : el.classList.contains('d2') ? 160 : el.classList.contains('d1') ? 80 : 0;
const revealObserver = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { ditherIn(e.target, 560, delayOf(e.target)); revealObserver.unobserve(e.target); }
}, {threshold:.15, rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach(el => reduced ? el.classList.add('in') : revealObserver.observe(el));

// pixel horizons
const heroCanvas = document.getElementById('heroCanvas');
Horizon(heroCanvas, { image: heroCanvas.dataset.image, rise: .84 });
Horizon(document.getElementById('communityCanvas'), { rise: .78, flip: true, cell: 4 });

// hero copy dithers in once the loader is gone
function heroIn(){
  ['.hero-eyebrow', '.hero h1', '.hero-sub', '.hero-cta'].forEach((sel, i) => {
    const el = document.querySelector(sel);
    if (el) ditherIn(el, 700, i * 140);
  });
}

// number formatting
const compact = n => {
  if (n >= 1e9) return (n/1e9).toFixed(n%1e9 ? 1 : 0) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(n%1e6 ? 1 : 0) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(n%1e3 ? 1 : 0) + 'K';
  return String(n);
};

// stat count-up
function countUp(el) {
  const target = +el.dataset.count;
  if (reduced) { el.textContent = compact(target); return; }
  const dur = 1400, t0 = performance.now();
  (function tick(t){
    const p = Math.min((t - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = compact(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}
const stat_io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) { countUp(e.target); stat_io.unobserve(e.target); }
}, {threshold:.6});
document.querySelectorAll('.count').forEach(el => stat_io.observe(el));

// live roblox stats
async function loadRoblox() {
  try {
    const uni = await (await fetch(`https://apis.roproxy.com/universes/v1/places/${PLACE_ID}/universe`)).json();
    const universe_id = uni.universeId;
    if (!universe_id) return;

    // game stats
    fetch(`https://games.roproxy.com/v1/games?universeIds=${universe_id}`)
      .then(r => r.json()).then(d => {
        const g = d.data && d.data[0];
        if (!g) return;
        setStat('statVisits', g.visits);
        setStat('statFavs', g.favoritedCount);
        document.getElementById('metaVisits').textContent = compact(g.visits);
        document.getElementById('metaFavs').textContent = compact(g.favoritedCount);
        document.getElementById('metaPlaying').textContent = compact(g.playing);
      }).catch(()=>{});

    // votes -> rating %
    fetch(`https://games.roproxy.com/v1/games/votes?universeIds=${universe_id}`)
      .then(r => r.json()).then(d => {
        const v = d.data && d.data[0];
        if (!v || (v.upVotes + v.downVotes) === 0) return;
        setStat('statRating', Math.round(v.upVotes / (v.upVotes + v.downVotes) * 100));
      }).catch(()=>{});

    // game icon
    fetch(`https://thumbnails.roproxy.com/v1/games/icons?universeIds=${universe_id}&size=512x512&format=Png&isCircular=false`)
      .then(r => r.json()).then(d => {
        const url = d.data && d.data[0] && d.data[0].imageUrl;
        if (!url) return;
        const img = document.getElementById('gameIcon');
        img.onload = () => { img.style.display = 'block'; document.getElementById('gameArtFallback').style.display = 'none'; };
        img.src = url;
      }).catch(()=>{});
  } catch(e) { /* fallbacks stay */ }

  // group member count
  fetch(`https://groups.roproxy.com/v1/groups/${GROUP_ID}`)
    .then(r => r.json()).then(d => { if (d.memberCount) setStat('statMembers', d.memberCount); })
    .catch(()=>{});
}
function setStat(id, val) {
  const el = document.getElementById(id);
  el.dataset.count = val;
  if (el.textContent !== '0') el.textContent = compact(val); // already showing, just update
}
loadRoblox();

// dev list (pulled from group roles)
async function loadDevs(){
  const track = document.getElementById('devTrack');
  try {
    const roles = await (await fetch(`https://groups.roproxy.com/v1/groups/${GROUP_ID}/roles`)).json();
    const wanted = DEV_ROLE_RANKS
      .map(rank => (roles.roles || []).find(r => r.rank === rank))
      .filter(Boolean);
    if (!wanted.length) return;

    // pull each role's members, tag each with a label
    const groups = await Promise.all(wanted.map(async role => {
      const res = await (await fetch(`https://groups.roproxy.com/v1/groups/${GROUP_ID}/roles/${role.id}/users?limit=100&sortOrder=Asc`)).json();
      const label = role.rank === CREATOR_RANK ? 'Creator' : role.name;
      return (res.data || []).map(u => ({...u, roleLabel: label}));
    }));

    const users = groups.flat().slice(0, DEV_LIMIT);
    if (!users.length) return;

    // avatars in one batch
    const ids = users.map(u => u.userId).join(',');
    const thumbs = await (await fetch(`https://thumbnails.roproxy.com/v1/users/avatar?userIds=${ids}&size=420x420&format=Png&isCircular=false`)).json();
    const thumb_by_id = {};
    (thumbs.data || []).forEach(t => { thumb_by_id[t.targetId] = t.imageUrl; });

    const esc = t => String(t).replace(/[<>&"]/g,'');
    const card = u => `
      <a class="dev" href="https://www.roblox.com/users/${u.userId}/profile" target="_blank" rel="noopener">
        <div class="dev-av">${thumb_by_id[u.userId] ? `<img src="${thumb_by_id[u.userId]}" alt="" loading="lazy">` : ''}</div>
        <div class="dev-name">${esc(u.displayName || u.username)}</div>
        <div class="dev-role">${esc(u.roleLabel)}</div>
      </a>`;

    // list is duplicated so the -50% scroll loop is seamless
    const html = users.map(card).join('');
    track.innerHTML = html + html;

    // slower scroll when there are more people
    track.style.animationDuration = Math.max(MARQUEE_MIN_S, users.length * MARQUEE_STEP_S) + 's';
  } catch(e) { /* stays empty rather than showing broken cards */ }
}
loadDevs();
