import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.106.2/+esm';

const config = window.APP_CONFIG || {};
const byId = (id) => document.getElementById(id);
const state = {
  client: null,
  session: null,
  profile: null,
  content: null,
  chapters: [],
  photos: [],
  photoUrls: new Map(),
  users: [],
  passwordFlow: false,
};

const screens = {
  loading: byId('loading-screen'),
  config: byId('config-screen'),
  auth: byId('auth-screen'),
  password: byId('password-screen'),
  app: byId('app-shell'),
};

function showOnly(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
}

function isConfigured() {
  const url = String(config.SUPABASE_URL || '').trim();
  const key = String(config.SUPABASE_PUBLISHABLE_KEY || '').trim();
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === 'https:' && Boolean(parsed.hostname) && parsed.hostname.includes('.');
  } catch {
    validUrl = false;
  }
  return validUrl
    && !url.includes('SEU-PROJETO')
    && (key.startsWith('sb_publishable_') || key.startsWith('eyJ'))
    && !key.includes('COLE_');
}

function baseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function detectPasswordFlow() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const type = query.get('type') || hash.get('type');
  return type === 'invite' || type === 'recovery' || window.location.hash.includes('access_token=');
}

function clearAuthParameters() {
  window.history.replaceState({}, document.title, baseUrl());
  state.passwordFlow = false;
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value || '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function formatDate(value, includeTime = true) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date);
}

function formatAction(action) {
  const labels = {
    invite_user: 'Acesso criado',
    resend_invite: 'Novo convite gerado',
    reset_password: 'Redefinição gerada',
    block_user: 'Usuário bloqueado',
    unblock_user: 'Usuário desbloqueado',
    change_role: 'Perfil alterado',
    delete_user: 'Usuário excluído',
    insert_site_content: 'Conteúdo criado',
    update_site_content: 'Conteúdo atualizado',
    delete_site_content: 'Conteúdo excluído',
    insert_chapters: 'Capítulo criado',
    update_chapters: 'Capítulo atualizado',
    delete_chapters: 'Capítulo excluído',
    insert_photos: 'Foto adicionada',
    update_photos: 'Foto atualizada',
    delete_photos: 'Foto excluída',
  };
  return labels[action] || String(action || '').replaceAll('_', ' ');
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  byId('toast-region').appendChild(item);
  window.setTimeout(() => item.remove(), 4500);
}

function setBusy(button, busy, busyText = 'Processando...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function confirmAction(title, message) {
  const dialog = byId('confirm-dialog');
  setText('confirm-title', title);
  setText('confirm-message', message);
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

function showAccessLink(title, message, actionLink) {
  const dialog = byId('access-link-dialog');
  setText('access-link-title', title);
  setText('access-link-message', message);
  byId('access-link-value').value = actionLink || '';
  dialog.showModal();
}

async function copyAccessLink() {
  const field = byId('access-link-value');
  if (!field.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API indisponível.');
    await navigator.clipboard.writeText(field.value);
  } catch (_) {
    field.focus();
    field.select();
    const copied = document.execCommand('copy');
    field.setSelectionRange(0, 0);
    if (!copied) throw new Error('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.');
  }
  toast('Link copiado.');
}

function humanError(error, fallback = 'Não foi possível concluir a operação.') {
  if (!error) return fallback;
  const message = String(error.message || error.error_description || error);
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha inválidos.';
  if (/email address not authorized/i.test(message)) return 'O envio automático não está habilitado para esse endereço. Escolha “Gerar link” ou configure SMTP no Supabase.';
  if (/email rate limit/i.test(message)) return 'Muitos e-mails foram solicitados. Tente novamente mais tarde.';
  if (/user already registered/i.test(message)) return 'Este e-mail já possui uma conta.';
  if (/jwt|token.*expired/i.test(message)) return 'Sua sessão expirou. Entre novamente.';
  if (/failed to fetch|network/i.test(message)) return 'Falha de conexão. Verifique a internet e tente novamente.';
  return message || fallback;
}

async function initialize() {
  if (!isConfigured()) {
    showOnly('config');
    return;
  }

  state.passwordFlow = detectPasswordFlow();
  state.client = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  state.client.auth.onAuthStateChange((event, session) => {
    window.setTimeout(async () => {
      if (event === 'SIGNED_OUT') {
        resetPrivateState();
        showOnly('auth');
      } else if (event === 'PASSWORD_RECOVERY') {
        state.session = session;
        state.passwordFlow = true;
        showOnly('password');
      }
    }, 0);
  });

  try {
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    state.session = data.session;

    if (state.session && state.passwordFlow) {
      showOnly('password');
      return;
    }

    if (state.session) {
      await enterApplication(state.session);
    } else {
      showOnly('auth');
    }
  } catch (error) {
    console.error(error);
    showOnly('auth');
    showLoginError('Não foi possível iniciar a sessão segura.');
  }
}

function resetPrivateState() {
  state.session = null;
  state.profile = null;
  state.content = null;
  state.chapters = [];
  state.photos = [];
  state.photoUrls.clear();
  state.users = [];
  document.title = 'Área restrita';

  [
    'brand-title', 'site-title', 'site-subtitle', 'hero-eyebrow', 'hero-text',
    'intro-eyebrow', 'intro-title', 'intro-body', 'quote-text', 'chapters-eyebrow',
    'chapters-title', 'gallery-eyebrow', 'gallery-title', 'letter-eyebrow',
    'letter-title', 'letter-body', 'letter-signature', 'footer-text', 'admin-welcome',
  ].forEach((id) => setText(id, id === 'brand-title' ? 'Área privada' : ''));

  ['chapters-list', 'gallery-grid', 'admin-chapters-list', 'admin-photos-list', 'users-body', 'logs-body']
    .forEach((id) => { byId(id).innerHTML = ''; });

  const coverImage = byId('cover-image');
  coverImage.removeAttribute('src');
  coverImage.alt = '';
  byId('cover-frame').hidden = true;
  byId('quote-section').hidden = true;
  byId('letter-section').hidden = true;
  byId('content-form').reset();
  byId('chapter-form').reset();
  byId('photo-form').reset();
  byId('invite-form').reset();
  byId('app-shell').hidden = true;
}

async function enterApplication(session) {
  showOnly('loading');
  state.session = session;

  try {
    const { data: profile, error: profileError } = await state.client
      .from('profiles')
      .select('id,email,display_name,role,status,created_at,updated_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new Error('Perfil de acesso não encontrado.');
    if (profile.status !== 'active') {
      await state.client.auth.signOut();
      showOnly('auth');
      showLoginError('Este acesso está bloqueado.');
      return;
    }

    state.profile = profile;
    await loadPrivateContent();
    renderApplication();
    showOnly('app');
    switchView('story');
  } catch (error) {
    console.error(error);
    await state.client.auth.signOut().catch(() => {});
    showOnly('auth');
    showLoginError(humanError(error, 'Seu acesso não pôde ser validado.'));
  }
}

async function loadPrivateContent() {
  const [contentResult, chaptersResult, photosResult] = await Promise.all([
    state.client.from('site_content').select('*').eq('id', 1).maybeSingle(),
    state.client.from('chapters').select('*').order('sort_order', { ascending: true }).order('chapter_number', { ascending: true }),
    state.client.from('photos').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
  ]);

  if (contentResult.error) throw contentResult.error;
  if (chaptersResult.error) throw chaptersResult.error;
  if (photosResult.error) throw photosResult.error;

  state.content = contentResult.data || emptyContent();
  state.chapters = chaptersResult.data || [];
  state.photos = photosResult.data || [];
  await refreshSignedUrls();
}

function emptyContent() {
  return {
    id: 1,
    title: 'Área privada',
    subtitle: '',
    hero_eyebrow: '',
    hero_text: '',
    intro_eyebrow: '',
    intro_title: '',
    intro_body: '',
    quote_text: '',
    chapters_eyebrow: 'Capítulos',
    chapters_title: 'Nossa história',
    gallery_eyebrow: 'Lembranças',
    gallery_title: 'Fotografias',
    letter_eyebrow: '',
    letter_title: '',
    letter_body: '',
    signature: '',
    footer_text: '',
  };
}

async function refreshSignedUrls() {
  state.photoUrls.clear();
  const seconds = Number(config.SIGNED_URL_SECONDS) || 3600;
  await Promise.all(state.photos.map(async (photo) => {
    const { data, error } = await state.client.storage
      .from(config.STORAGE_BUCKET)
      .createSignedUrl(photo.storage_path, seconds);
    if (!error && data?.signedUrl) state.photoUrls.set(photo.id, data.signedUrl);
  }));
}

function renderApplication() {
  const content = state.content || emptyContent();
  document.title = content.title || 'Área privada';
  setText('brand-title', content.title || 'Área privada');
  setText('site-title', content.title);
  setText('site-subtitle', content.subtitle);
  setText('hero-eyebrow', content.hero_eyebrow);
  setText('hero-text', content.hero_text);
  setText('intro-eyebrow', content.intro_eyebrow);
  setText('intro-title', content.intro_title);
  setText('intro-body', content.intro_body);
  setText('chapters-eyebrow', content.chapters_eyebrow || 'Capítulos');
  setText('chapters-title', content.chapters_title || 'Nossa história');
  setText('gallery-eyebrow', content.gallery_eyebrow || 'Lembranças');
  setText('gallery-title', content.gallery_title || 'Fotografias');
  setText('letter-eyebrow', content.letter_eyebrow);
  setText('letter-title', content.letter_title);
  setText('letter-body', content.letter_body);
  setText('letter-signature', content.signature);
  setText('footer-text', content.footer_text);

  const quoteSection = byId('quote-section');
  quoteSection.hidden = !content.quote_text;
  setText('quote-text', content.quote_text);

  const letterSection = byId('letter-section');
  letterSection.hidden = !(content.letter_title || content.letter_body);

  renderChapters();
  renderPhotos();
  renderCover();

  const isAdmin = state.profile?.role === 'admin';
  byId('admin-nav').hidden = !isAdmin;
  if (isAdmin) {
    setText('admin-welcome', `Conectado como ${state.profile.display_name || state.profile.email}.`);
    populateContentForm();
    renderAdminChapters();
    renderAdminPhotos();
  }
}

function renderChapters() {
  const list = byId('chapters-list');
  const chapters = state.chapters.filter((chapter) => chapter.published);
  list.innerHTML = '';
  byId('chapters-empty').hidden = chapters.length > 0;

  chapters.forEach((chapter) => {
    const article = document.createElement('article');
    article.className = 'chapter';
    const marker = document.createElement('div');
    marker.className = 'chapter-number-mark';
    marker.textContent = String(chapter.chapter_number || '');
    const copy = document.createElement('div');
    copy.className = 'chapter-copy';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = chapter.label || '';
    const title = document.createElement('h3');
    title.textContent = chapter.title || '';
    const body = document.createElement('p');
    body.className = 'preserve-lines';
    body.textContent = chapter.body || '';
    copy.append(eyebrow, title, body);
    article.append(marker, copy);
    list.appendChild(article);
  });
}

function renderCover() {
  const cover = state.photos.find((photo) => photo.placement === 'cover');
  const frame = byId('cover-frame');
  const image = byId('cover-image');
  if (!cover || !state.photoUrls.get(cover.id)) {
    frame.hidden = true;
    image.removeAttribute('src');
    return;
  }
  image.src = state.photoUrls.get(cover.id);
  image.alt = cover.alt_text || 'Imagem principal';
  frame.hidden = false;
}

function renderPhotos() {
  const grid = byId('gallery-grid');
  const photos = state.photos.filter((photo) => photo.placement === 'gallery' && state.photoUrls.has(photo.id));
  grid.innerHTML = '';
  byId('gallery-empty').hidden = photos.length > 0;

  photos.forEach((photo) => {
    const figure = document.createElement('figure');
    figure.className = 'gallery-item';
    const image = document.createElement('img');
    image.src = state.photoUrls.get(photo.id);
    image.alt = photo.alt_text || 'Fotografia da galeria';
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    const title = document.createElement('h3');
    title.textContent = photo.alt_text || 'Lembrança';
    const text = document.createElement('p');
    text.textContent = photo.caption || '';
    caption.append(title, text);
    figure.append(image, caption);
    grid.appendChild(figure);
  });
}

function switchView(viewName) {
  if (viewName === 'admin' && state.profile?.role !== 'admin') viewName = 'story';
  ['story', 'gallery', 'admin'].forEach((name) => {
    byId(`${name}-view`).hidden = name !== viewName;
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewName && button.classList.contains('nav-button'));
  });
  document.body.classList.remove('menu-open');
  byId('mobile-menu').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchAdminPanel(panelName) {
  ['content', 'chapters', 'photos', 'users', 'logs'].forEach((name) => {
    byId(`panel-${name}`).hidden = name !== panelName;
  });
  document.querySelectorAll('.admin-tab').forEach((button) => button.classList.toggle('active', button.dataset.panel === panelName));
  if (panelName === 'users') loadUsers();
  if (panelName === 'logs') loadLogs();
}

function populateContentForm() {
  const c = state.content || emptyContent();
  const fields = {
    'edit-title': c.title,
    'edit-subtitle': c.subtitle,
    'edit-hero-eyebrow': c.hero_eyebrow,
    'edit-hero-text': c.hero_text,
    'edit-intro-eyebrow': c.intro_eyebrow,
    'edit-intro-title': c.intro_title,
    'edit-intro-body': c.intro_body,
    'edit-quote': c.quote_text,
    'edit-chapters-eyebrow': c.chapters_eyebrow,
    'edit-chapters-title': c.chapters_title,
    'edit-gallery-eyebrow': c.gallery_eyebrow,
    'edit-gallery-title': c.gallery_title,
    'edit-letter-eyebrow': c.letter_eyebrow,
    'edit-letter-title': c.letter_title,
    'edit-letter-body': c.letter_body,
    'edit-signature': c.signature,
    'edit-footer': c.footer_text,
  };
  Object.entries(fields).forEach(([id, value]) => { byId(id).value = value || ''; });
}

function renderAdminChapters() {
  const list = byId('admin-chapters-list');
  list.innerHTML = '';
  if (!state.chapters.length) {
    list.innerHTML = '<p class="empty">Nenhum capítulo cadastrado.</p>';
    return;
  }
  state.chapters.forEach((chapter) => {
    const item = document.createElement('article');
    item.className = 'admin-list-item';
    item.innerHTML = `
      <div>
        <h3>${escapeHtml(chapter.chapter_number)}. ${escapeHtml(chapter.title)}</h3>
        <p>${escapeHtml(chapter.label || 'Sem identificação')} · Ordem ${escapeHtml(chapter.sort_order)} · ${chapter.published ? 'Publicado' : 'Oculto'}</p>
      </div>
      <div class="item-actions">
        <button class="secondary small" type="button" data-chapter-action="edit" data-id="${escapeHtml(chapter.id)}">Editar</button>
        <button class="danger small" type="button" data-chapter-action="delete" data-id="${escapeHtml(chapter.id)}">Excluir</button>
      </div>`;
    list.appendChild(item);
  });
}

function openChapterEditor(chapter = null) {
  byId('chapter-form').hidden = false;
  byId('chapter-id').value = chapter?.id || '';
  byId('chapter-label').value = chapter?.label || '';
  byId('chapter-title-input').value = chapter?.title || '';
  byId('chapter-number').value = chapter?.chapter_number || Math.max(1, state.chapters.length + 1);
  byId('chapter-order').value = chapter?.sort_order ?? state.chapters.length;
  byId('chapter-published').checked = chapter?.published ?? true;
  byId('chapter-body-input').value = chapter?.body || '';
  byId('chapter-title-input').focus();
}

function closeChapterEditor() {
  byId('chapter-form').reset();
  byId('chapter-id').value = '';
  byId('chapter-form').hidden = true;
}

function renderAdminPhotos() {
  const list = byId('admin-photos-list');
  const photos = state.photos.filter((photo) => photo.placement === 'gallery');
  list.innerHTML = '';
  if (!photos.length) {
    list.innerHTML = '<p class="empty">Nenhuma fotografia cadastrada.</p>';
    return;
  }
  photos.forEach((photo) => {
    const item = document.createElement('article');
    item.className = 'admin-list-item';
    const url = state.photoUrls.get(photo.id) || '';
    item.innerHTML = `
      <div class="thumb">${url ? `<img src="${escapeHtml(url)}" alt="">` : ''}</div>
      <div><h3>${escapeHtml(photo.alt_text || 'Fotografia')}</h3><p>${escapeHtml(photo.caption || 'Sem legenda')} · Ordem ${escapeHtml(photo.sort_order)}</p></div>
      <div class="item-actions"><button class="danger small" type="button" data-photo-action="delete" data-id="${escapeHtml(photo.id)}">Excluir</button></div>`;
    list.appendChild(item);
  });
}

function validateImage(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!file || !allowed.includes(file.type)) throw new Error('Selecione uma imagem JPG, PNG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 15 MB.');
}

function fileExtension(file) {
  const byType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return byType[file.type] || 'jpg';
}

async function uploadPrivatePhoto(file, folder) {
  validateImage(file);
  const path = `${folder}/${crypto.randomUUID()}.${fileExtension(file)}`;
  const { error } = await state.client.storage.from(config.STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

async function removePhotoRecord(photo) {
  const { error: databaseError } = await state.client.from('photos').delete().eq('id', photo.id);
  if (databaseError) throw databaseError;
  const storageResult = await state.client.storage.from(config.STORAGE_BUCKET).remove([photo.storage_path]);
  if (storageResult.error) {
    console.warn('O registro foi removido, mas o arquivo não pôde ser apagado:', storageResult.error.message);
  }
}

async function cleanupUploadedPhoto(storagePath) {
  if (!storagePath) return;
  try {
    await state.client.from('photos').delete().eq('storage_path', storagePath);
  } catch (_) {}
  try {
    await state.client.storage.from(config.STORAGE_BUCKET).remove([storagePath]);
  } catch (_) {}
}

async function reloadChapters() {
  const { data, error } = await state.client.from('chapters').select('*').order('sort_order').order('chapter_number');
  if (error) throw error;
  state.chapters = data || [];
  renderChapters();
  renderAdminChapters();
}

async function reloadPhotos() {
  const { data, error } = await state.client.from('photos').select('*').order('sort_order').order('created_at');
  if (error) throw error;
  state.photos = data || [];
  await refreshSignedUrls();
  renderCover();
  renderPhotos();
  renderAdminPhotos();
}

async function invokeAdmin(body) {
  const { data, error } = await state.client.functions.invoke(config.ADMIN_FUNCTION, { body });
  if (error) {
    let message = error.message;
    try {
      const context = await error.context?.json();
      message = context?.error || context?.message || message;
    } catch (_) {}
    throw new Error(message || 'Falha na função administrativa.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadUsers() {
  if (state.profile?.role !== 'admin') return;
  const button = byId('refresh-users');
  setBusy(button, true, 'Atualizando...');
  try {
    const result = await invokeAdmin({ action: 'list' });
    state.users = result.users || [];
    renderUsers();
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function renderUsers() {
  const body = byId('users-body');
  body.innerHTML = '';
  byId('users-empty').hidden = state.users.length > 0;

  state.users.forEach((user) => {
    const ownAccount = user.id === state.profile.id;
    const protectedAccount = ownAccount || Boolean(user.is_owner);
    const pending = !user.email_confirmed_at;
    const statusLabel = user.status === 'blocked' ? 'Bloqueado' : pending ? 'Convite pendente' : 'Ativo';
    const statusClass = user.status === 'blocked' ? 'blocked' : pending ? 'pending' : '';
    const targetRole = user.role === 'admin' ? 'reader' : 'admin';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="user-cell"><strong>${escapeHtml(user.display_name || 'Sem nome')}${ownAccount ? ' (você)' : ''}</strong><span>${escapeHtml(user.email)}</span></td>
      <td><span class="role ${user.role === 'reader' ? 'reader' : ''}">${user.role === 'admin' ? 'Administrador' : 'Leitor'}</span></td>
      <td><span class="status ${statusClass}">${statusLabel}</span></td>
      <td>${escapeHtml(formatDate(user.last_sign_in_at))}</td>
      <td><div class="table-actions">
        ${protectedAccount ? `<span>${ownAccount ? 'Conta principal' : 'Administrador principal'}</span>` : `
          <button class="secondary small" type="button" data-user-action="role" data-id="${escapeHtml(user.id)}" data-role="${targetRole}">${targetRole === 'admin' ? 'Tornar admin' : 'Tornar leitor'}</button>
          <button class="secondary small" type="button" data-user-action="status" data-id="${escapeHtml(user.id)}" data-status="${user.status === 'blocked' ? 'active' : 'blocked'}">${user.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}</button>
          <button class="secondary small" type="button" data-user-action="${pending ? 'resend' : 'reset'}" data-id="${escapeHtml(user.id)}">${pending ? 'Gerar novo convite' : 'Gerar redefinição'}</button>
          <button class="danger small" type="button" data-user-action="delete" data-id="${escapeHtml(user.id)}">Excluir</button>`}
      </div></td>`;
    body.appendChild(row);
  });
}

async function loadLogs() {
  if (state.profile?.role !== 'admin') return;
  const button = byId('refresh-logs');
  setBusy(button, true, 'Atualizando...');
  try {
    const [logsResult, profilesResult] = await Promise.all([
      state.client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200),
      state.client.from('profiles').select('id,email,display_name'),
    ]);
    if (logsResult.error) throw logsResult.error;
    if (profilesResult.error) throw profilesResult.error;
    const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
    const body = byId('logs-body');
    body.innerHTML = '';
    const logs = logsResult.data || [];
    byId('logs-empty').hidden = logs.length > 0;
    logs.forEach((log) => {
      const actor = profileMap.get(log.actor_id);
      const details = log.details || {};
      const detailText = details.target_email || details.email || details.record_id || details.role || '—';
      const row = document.createElement('tr');
      row.innerHTML = `<td>${escapeHtml(formatDate(log.created_at))}</td><td>${escapeHtml(actor?.display_name || actor?.email || 'Sistema')}</td><td>${escapeHtml(formatAction(log.action))}</td><td>${escapeHtml(detailText)}</td>`;
      body.appendChild(row);
    });
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function showLoginError(message) {
  const element = byId('login-error');
  element.textContent = message;
  element.hidden = false;
}

function hideLoginError() {
  byId('login-error').hidden = true;
}

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideLoginError();
  const button = byId('login-submit');
  setBusy(button, true, 'Entrando...');
  try {
    const email = byId('login-email').value.trim().toLowerCase();
    const password = byId('login-password').value;
    if (!email || password.length < 8) throw new Error('Informe o e-mail e a senha corretamente.');
    const { data, error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterApplication(data.session);
    byId('login-password').value = '';
  } catch (error) {
    showLoginError(humanError(error));
  } finally {
    setBusy(button, false);
  }
});

byId('forgot-open').addEventListener('click', () => {
  byId('forgot-form').hidden = false;
  byId('forgot-email').value = byId('login-email').value;
  byId('forgot-email').focus();
});

byId('forgot-cancel').addEventListener('click', () => {
  byId('forgot-form').hidden = true;
  byId('forgot-message').hidden = true;
});

byId('forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Enviando...');
  const message = byId('forgot-message');
  try {
    const email = byId('forgot-email').value.trim().toLowerCase();
    if (!email) throw new Error('Informe o e-mail cadastrado.');
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo: baseUrl() });
    if (error) throw error;
    message.textContent = 'Se o e-mail estiver cadastrado, o link de recuperação será enviado.';
    message.classList.remove('error');
    message.hidden = false;
  } catch (error) {
    message.textContent = humanError(error);
    message.classList.add('error');
    message.hidden = false;
  } finally {
    setBusy(button, false);
  }
});

byId('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const errorElement = byId('password-error');
  errorElement.hidden = true;
  setBusy(button, true, 'Salvando...');
  try {
    const password = byId('new-password').value;
    const confirmation = byId('confirm-password').value;
    if (password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
    if (password !== confirmation) throw new Error('As senhas não coincidem.');
    const { error } = await state.client.auth.updateUser({ password });
    if (error) throw error;
    const { data } = await state.client.auth.getSession();
    clearAuthParameters();
    toast('Senha criada com sucesso.');
    await enterApplication(data.session);
  } catch (error) {
    errorElement.textContent = humanError(error);
    errorElement.hidden = false;
  } finally {
    setBusy(button, false);
  }
});

document.querySelectorAll('.password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = byId(button.dataset.target);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Ver' : 'Ocultar';
  });
});

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('.admin-tab').forEach((button) => button.addEventListener('click', () => switchAdminPanel(button.dataset.panel)));
document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => byId(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));

byId('mobile-menu').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  byId('mobile-menu').setAttribute('aria-expanded', String(open));
});

byId('logout-button').addEventListener('click', async () => {
  await state.client.auth.signOut();
  resetPrivateState();
  showOnly('auth');
});

byId('content-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Salvando...');
  try {
    const payload = {
      id: 1,
      title: byId('edit-title').value.trim(),
      subtitle: byId('edit-subtitle').value.trim(),
      hero_eyebrow: byId('edit-hero-eyebrow').value.trim(),
      hero_text: byId('edit-hero-text').value.trim(),
      intro_eyebrow: byId('edit-intro-eyebrow').value.trim(),
      intro_title: byId('edit-intro-title').value.trim(),
      intro_body: byId('edit-intro-body').value.trim(),
      quote_text: byId('edit-quote').value.trim(),
      chapters_eyebrow: byId('edit-chapters-eyebrow').value.trim(),
      chapters_title: byId('edit-chapters-title').value.trim(),
      gallery_eyebrow: byId('edit-gallery-eyebrow').value.trim(),
      gallery_title: byId('edit-gallery-title').value.trim(),
      letter_eyebrow: byId('edit-letter-eyebrow').value.trim(),
      letter_title: byId('edit-letter-title').value.trim(),
      letter_body: byId('edit-letter-body').value.trim(),
      signature: byId('edit-signature').value.trim(),
      footer_text: byId('edit-footer').value.trim(),
    };
    if (!payload.title) throw new Error('Informe o título do site.');
    const { data, error } = await state.client.from('site_content').upsert(payload).select().single();
    if (error) throw error;
    state.content = data;
    renderApplication();
    toast('Textos salvos.');
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('cover-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Enviando...');
  let uploadedPath = null;
  try {
    const file = byId('cover-file').files[0];
    uploadedPath = await uploadPrivatePhoto(file, 'cover');
    const oldCover = state.photos.find((photo) => photo.placement === 'cover');
    const { error } = await state.client.from('photos').insert({
      storage_path: uploadedPath,
      placement: 'cover',
      alt_text: 'Imagem principal',
      caption: '',
      sort_order: 0,
    });
    if (error) throw error;
    if (oldCover) await removePhotoRecord(oldCover);
    byId('cover-file').value = '';
    await reloadPhotos();
    toast('Imagem principal atualizada.');
  } catch (error) {
    await cleanupUploadedPhoto(uploadedPath);
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('cover-remove').addEventListener('click', async () => {
  const cover = state.photos.find((photo) => photo.placement === 'cover');
  if (!cover) return toast('Não há imagem principal para remover.', 'warning');
  if (!await confirmAction('Remover imagem', 'A imagem principal será excluída permanentemente.')) return;
  try {
    await removePhotoRecord(cover);
    await reloadPhotos();
    toast('Imagem removida.');
  } catch (error) {
    toast(humanError(error), 'error');
  }
});

byId('new-chapter').addEventListener('click', () => openChapterEditor());
byId('chapter-cancel').addEventListener('click', closeChapterEditor);

byId('chapter-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Salvando...');
  try {
    const id = byId('chapter-id').value;
    const payload = {
      label: byId('chapter-label').value.trim(),
      title: byId('chapter-title-input').value.trim(),
      chapter_number: Number(byId('chapter-number').value),
      sort_order: Number(byId('chapter-order').value),
      published: byId('chapter-published').checked,
      body: byId('chapter-body-input').value.trim(),
    };
    if (!payload.title || !payload.body || payload.chapter_number < 1) throw new Error('Preencha título, número e texto do capítulo.');
    const query = id
      ? state.client.from('chapters').update(payload).eq('id', id)
      : state.client.from('chapters').insert(payload);
    const { error } = await query;
    if (error) throw error;
    closeChapterEditor();
    await reloadChapters();
    toast(id ? 'Capítulo atualizado.' : 'Capítulo criado.');
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('admin-chapters-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-chapter-action]');
  if (!button) return;
  const chapter = state.chapters.find((item) => item.id === button.dataset.id);
  if (!chapter) return;
  if (button.dataset.chapterAction === 'edit') {
    openChapterEditor(chapter);
    return;
  }
  if (!await confirmAction('Excluir capítulo', `O capítulo “${chapter.title}” será excluído permanentemente.`)) return;
  try {
    const { error } = await state.client.from('chapters').delete().eq('id', chapter.id);
    if (error) throw error;
    await reloadChapters();
    toast('Capítulo excluído.');
  } catch (error) {
    toast(humanError(error), 'error');
  }
});

byId('photo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Enviando...');
  let uploadedPath = null;
  try {
    const file = byId('photo-file').files[0];
    uploadedPath = await uploadPrivatePhoto(file, 'gallery');
    const { error } = await state.client.from('photos').insert({
      storage_path: uploadedPath,
      placement: 'gallery',
      alt_text: byId('photo-alt').value.trim(),
      caption: byId('photo-caption').value.trim(),
      sort_order: Number(byId('photo-order').value),
    });
    if (error) throw error;
    byId('photo-form').reset();
    byId('photo-order').value = '0';
    await reloadPhotos();
    toast('Fotografia adicionada.');
  } catch (error) {
    await cleanupUploadedPhoto(uploadedPath);
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('admin-photos-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-photo-action="delete"]');
  if (!button) return;
  const photo = state.photos.find((item) => item.id === button.dataset.id);
  if (!photo) return;
  if (!await confirmAction('Excluir fotografia', 'A fotografia será removida permanentemente do armazenamento privado.')) return;
  try {
    await removePhotoRecord(photo);
    await reloadPhotos();
    toast('Fotografia excluída.');
  } catch (error) {
    toast(humanError(error), 'error');
  }
});

byId('invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Criando...');
  try {
    const delivery = byId('invite-delivery').value;
    const result = await invokeAdmin({
      action: 'invite',
      name: byId('invite-name').value.trim(),
      email: byId('invite-email').value.trim().toLowerCase(),
      role: byId('invite-role').value,
      delivery,
      redirectTo: baseUrl(),
    });
    byId('invite-form').reset();
    if (result.actionLink) {
      showAccessLink('Acesso criado', 'Copie este link e envie somente à pessoa autorizada. Ela poderá definir a própria senha.', result.actionLink);
    } else {
      toast('Convite enviado por e-mail.');
    }
    await loadUsers();
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('users-body').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const user = state.users.find((item) => item.id === button.dataset.id);
  if (!user) return;
  const action = button.dataset.userAction;
  let request;
  let confirmation = true;

  if (action === 'role') {
    confirmation = await confirmAction('Alterar perfil', `Deseja alterar ${user.email} para ${button.dataset.role === 'admin' ? 'administrador' : 'leitor'}?`);
    request = { action: 'set-role', userId: user.id, role: button.dataset.role };
  } else if (action === 'status') {
    confirmation = await confirmAction(button.dataset.status === 'blocked' ? 'Bloquear acesso' : 'Desbloquear acesso', `${user.email} será ${button.dataset.status === 'blocked' ? 'bloqueado' : 'desbloqueado'}.`);
    request = { action: 'set-status', userId: user.id, status: button.dataset.status };
  } else if (action === 'resend') {
    request = { action: 'resend-invite', userId: user.id, redirectTo: baseUrl() };
  } else if (action === 'reset') {
    request = { action: 'reset-password', userId: user.id, redirectTo: baseUrl() };
  } else if (action === 'delete') {
    confirmation = await confirmAction('Excluir usuário', `A conta ${user.email} será excluída. Essa ação não pode ser desfeita.`);
    request = { action: 'delete', userId: user.id };
  }

  if (!confirmation || !request) return;
  setBusy(button, true, '...');
  try {
    const result = await invokeAdmin(request);
    if (result.actionLink) {
      showAccessLink(
        action === 'resend' ? 'Novo convite gerado' : 'Redefinição gerada',
        action === 'resend'
          ? 'Envie este link somente à pessoa autorizada para que ela crie a senha.'
          : 'Envie este link somente ao titular da conta para que ele defina uma nova senha.',
        result.actionLink,
      );
    } else {
      toast('Acesso atualizado.');
    }
    await loadUsers();
  } catch (error) {
    toast(humanError(error), 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('copy-access-link').addEventListener('click', async () => {
  try {
    await copyAccessLink();
  } catch (error) {
    toast(humanError(error), 'error');
  }
});
byId('access-link-dialog').addEventListener('close', () => { byId('access-link-value').value = ''; });

byId('refresh-users').addEventListener('click', loadUsers);
byId('refresh-logs').addEventListener('click', loadLogs);

initialize();
