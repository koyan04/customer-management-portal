import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';
import { FaKey, FaServer } from 'react-icons/fa';

export default function AdminEditorForm({ isOpen, onClose, onSaved, account, servers = [] }) {
  const { token, user: authUser } = useAuth();
  const isEdit = !!account?.id;
  const [form, setForm] = useState({ display_name: '', username: '', password: '', role: 'VIEWER' });
  const [selectedServers, setSelectedServers] = useState([]);
  // server-admin selections will be derived from role + selectedServers; no separate state needed
  const [saving, setSaving] = useState(false);
  const [errorToast, setErrorToast] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showReset, setShowReset] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [clearAvatar, setClearAvatar] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const makeAbsolute = (url) => {
    if (!url) return url;
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      // assume server running on :3001 in dev
      const origin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
      return origin + url;
    } catch (e) { return url; }
  };

  useEffect(() => {
    if (account) {
  setForm({ display_name: account.display_name || '', username: account.username || '', password: '', role: account.role || 'VIEWER' });
  // prefer server-backed avatar_url if present, otherwise fall back to base64 avatar_data
  const av = account.avatar_url || account.avatar_data || null;
  setAvatarPreview(av && typeof av === 'string' && av.startsWith('/') ? makeAbsolute(av) : av);
      // fetch assigned servers for this editor (viewer/server permissions)
      (async () => {
        try {
          // When editing own profile, directly use the self endpoint to avoid 403 noise
          const url = isProfile ? '/api/admin/permissions/me' : `/api/admin/permissions/${account.id}`;
          const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
          const d = res.data;
          const normalized = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []);
          if (account.role === 'ADMIN') {
            setSelectedServers([]);
          } else {
            setSelectedServers(normalized || []);
          }
        } catch (err) {
          setSelectedServers([]);
        }
      })();

      // no separate server-admin fetch: server-admin role is inferred from role + selectedServers
    } else {
      setForm({ display_name: '', username: '', password: '', role: 'VIEWER' });
      setSelectedServers([]);
      // no server-admin state
      setAvatarPreview(null);
    }
  }, [account, token, isOpen]);

  // determine if this editor is the current logged-in user's profile
  const currentUserId = authUser?.user?.id || authUser?.id;
  const isProfile = Boolean(account && account.id && currentUserId && account.id === currentUserId);
  // when editing your own profile as a VIEWER or SERVER_ADMIN we hide some admin-only controls
  const hideRoleAndReset = isProfile && (form.role === 'VIEWER' || form.role === 'SERVER_ADMIN');
  // compact modal styling applies for non-global-admin account types (viewer/server-admin)
  const compactForRole = (form.role === 'VIEWER' || form.role === 'SERVER_ADMIN');
  // Add Viewer modal detection: non-profile, add mode, and role is VIEWER
  const isAddViewer = !isProfile && !isEdit && form.role === 'VIEWER';
  // Add Server Admin modal detection: non-profile, add mode, and role is SERVER_ADMIN
  const isAddServerAdmin = !isProfile && !isEdit && form.role === 'SERVER_ADMIN';

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'server') {
      const id = Number(value);
      setSelectedServers(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
    } else {
      // special-case role changes: if switching to global ADMIN, clear any server permissions
      if (name === 'role') {
        setForm(prev => ({ ...prev, [name]: value }));
        if (value === 'ADMIN') {
          setSelectedServers([]);
        }
      } else {
        setForm(prev => ({ ...prev, [name]: value }));
      }
    }
  };

  const handleAvatar = (e) => {
    const f = e.target.files && e.target.files[0];
  if (!f) return;
    // selecting a new file clears any previous "remove" flag
    setClearAvatar(false);
    // client-side resize to 256px max to improve upload reliability and reduce payload
    const resizeAndSet = async (file) => {
      try {
        const resized = await resizeImageFile(file, 256);
        // limit final blob size to ~2MB as a safety (should be much smaller)
        const max = 2 * 1024 * 1024;
        if (resized.size > max) {
          setErrorToast('Selected image is still too large after resizing. Please choose a smaller image.');
          e.target.value = null;
          setTimeout(() => setErrorToast(null), 4000);
          return;
        }
        const resizedFile = new File([resized], file.name, { type: resized.type });
        setAvatarFile(resizedFile);
        const reader = new FileReader();
        reader.onload = () => setAvatarPreview(reader.result);
        reader.readAsDataURL(resized);
      } catch (err) {
        console.error('Failed to resize image:', err);
        // fallback to original file preview
        setAvatarFile(file);
        const reader = new FileReader();
        reader.onload = () => setAvatarPreview(reader.result);
        reader.readAsDataURL(file);
      }
    };
    resizeAndSet(f);
  };

  // helper: resize image file to square max dimension using canvas, return Blob
  const resizeImageFile = (file, maxSize) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let { width, height } = img;
        const scale = Math.min(maxSize / width, maxSize / height, 1);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        canvas.width = maxSize; // make square canvas to center-crop
        canvas.height = maxSize;
        // draw background transparent
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // compute draw offsets to center the image
        const dx = Math.round((canvas.width - width) / 2);
        const dy = Math.round((canvas.height - height) / 2);
        ctx.drawImage(img, dx, dy, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error('Canvas toBlob returned null'));
          resolve(blob);
        }, 'image/jpeg', 0.8);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('Image load error')); };
    img.src = url;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
  setSaving(true);
    try {
      if (!token) {
        alert('You must be logged in as an admin to perform this action');
        setSaving(false);
        return;
      }
      let editorId = account?.id;
      // if we have a selected file, send FormData multipart; otherwise fall back to JSON (keeps backward compatibility)
  if (avatarFile) {
        console.debug('Submitting with FormData. file size:', avatarFile.size);
        const fd = new FormData();
        fd.append('display_name', form.display_name);
        fd.append('role', form.role);
        if (!isEdit) {
          fd.append('username', form.username);
          fd.append('password', form.password);
        }
        if (isEdit && !isProfile && form.username) {
          // allow admin panel to update username when editing
          fd.append('username', form.username);
        }
        fd.append('avatar', avatarFile);
        try {
          // use XMLHttpRequest to get upload progress events
          const headers = { 'Authorization': `Bearer ${token}` };
          const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
          const url = backendOrigin + (isEdit ? `/api/admin/accounts/${editorId}` : '/api/admin/accounts');
          setUploadProgress(0);
          const method = isEdit ? 'PUT' : 'POST';
          const resp = await uploadFormDataWithProgress(method, url, fd, headers, (pct) => setUploadProgress(pct));
          setUploadProgress(null);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          if (!isEdit) {
            const data = await resp.json();
            editorId = data.id;
          }
        } catch (err) {
          setUploadProgress(null);
          console.warn('FormData submit failed, will retry with JSON base64 payload. Error:', err && err.message ? err.message : err);
          // fallback: send base64 avatar in JSON (we already have avatarPreview)
          if (isEdit) {
            const payload = { display_name: form.display_name, role: form.role, avatar_data: avatarPreview, clear_avatar: clearAvatar };
            if (!isProfile && form.username) payload.username = form.username;
            await axios.put(`/api/admin/accounts/${editorId}`, payload, { headers: { Authorization: `Bearer ${token}` } });
          } else {
            const res = await axios.post('/api/admin/accounts', { display_name: form.display_name, username: form.username, password: form.password, role: form.role, avatar_data: avatarPreview, clear_avatar: clearAvatar }, { headers: { Authorization: `Bearer ${token}` } });
            editorId = res.data.id;
          }
        }
      } else {
        console.debug('Submitting JSON payload. avatarPreview length:', avatarPreview ? avatarPreview.length : 0);
        if (isEdit) {
          const payload = { display_name: form.display_name, role: form.role, avatar_data: avatarPreview, clear_avatar: clearAvatar };
          if (!isProfile && form.username) payload.username = form.username;
          await axios.put(`/api/admin/accounts/${editorId}`, payload, { headers: { Authorization: `Bearer ${token}` } });
        } else {
          const res = await axios.post('/api/admin/accounts', { display_name: form.display_name, username: form.username, password: form.password, role: form.role, avatar_data: avatarPreview, clear_avatar: clearAvatar }, { headers: { Authorization: `Bearer ${token}` } });
          editorId = res.data.id;
        }
      }

      // update viewer/server permissions (use backend origin so requests go to Express server, not vite dev proxy)
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';

      // If the account is a global ADMIN, we want to clear any server/viewer scoped permissions
      // so that admins don't retain server-scoped restrictions. Send empty arrays and also
      // clear server-admin mappings explicitly.
      if (form.role === 'ADMIN') {
        try {
          await axios.post(backendOrigin + '/api/admin/permissions', { editor_id: editorId, server_ids: [] }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (err) {
          console.warn('Failed to clear viewer permissions for ADMIN account', err && err.response ? err.response.data : err);
        }
        try {
          await axios.post(backendOrigin + '/api/admin/server-admins', { admin_id: editorId, server_ids: [] }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (err) {
          console.warn('Failed to clear server-admin mappings for ADMIN account', err && err.response ? err.response.data : err);
        }
      } else {
        // normal flow: set viewer permissions to selectedServers (may be empty array)
        await axios.post(backendOrigin + '/api/admin/permissions', { editor_id: editorId, server_ids: selectedServers }, { headers: { Authorization: `Bearer ${token}` } });

        // if the selected role is SERVER_ADMIN, apply server-admin assignments equal to selectedServers
        if (form.role === 'SERVER_ADMIN') {
          try {
            await axios.post(backendOrigin + '/api/admin/server-admins', { admin_id: editorId, server_ids: selectedServers }, { headers: { Authorization: `Bearer ${token}` } });
          } catch (err) {
            console.warn('Failed to update server-admin assignments (may not be authorized)', err && err.response ? err.response.data : err);
          }
        }
      }

      // if admin requested to reset the password for this edited account
      if (isEdit && showReset) {
        if (!resetPassword || resetPassword.length < 6) throw new Error('New password must be at least 6 characters');
        if (resetPassword !== resetPasswordConfirm) throw new Error('New password and confirm do not match');
        await axios.post(`/api/admin/accounts/${editorId}/reset-password`, { newPassword: resetPassword }, { headers: { Authorization: `Bearer ${token}` } });
      }

      // after saving, fetch the updated account to get the latest avatar_url
      try {
        if (editorId) {
          const res = await axios.get(`/api/admin/accounts/${editorId}`, { headers: { Authorization: `Bearer ${token}` } });
          const updated = res.data;
          const av2 = updated.avatar_url || updated.avatar_data || avatarPreview;
          setAvatarPreview(av2 && typeof av2 === 'string' && av2.startsWith('/') ? makeAbsolute(av2) : av2);
        }
      } catch (fetchErr) {
        console.warn('Failed to fetch updated account after save', fetchErr);
      }

      // show success toast briefly
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1800);

  // bump avatar refresh token so other parts of the UI (header) can bust caches
  try { localStorage.setItem('avatar_refresh', String(Date.now())); } catch (e) {}

  onSaved(editorId);
  onClose();
    } catch (err) {
      // log full error details for debugging
      console.error('Failed to save account', err);
      if (err.response) {
        console.error('Server response:', err.response.status, err.response.data);
        const serverMsg = err.response.data?.msg || err.response.data || JSON.stringify(err.response.data);
        setErrorToast(`Error saving account: ${serverMsg} (${err.response.status})`);
      } else {
        setErrorToast(`Error saving account: ${err.message}`);
      }
      setTimeout(() => setErrorToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  // helper: upload FormData with progress callback using XHR; returns an object with ok,status,json()
  const uploadFormDataWithProgress = (method, url, formData, headers = {}, onProgress = () => {}) => new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open(method || 'POST', url);
      // set headers (avoid setting Content-Type for multipart)
      Object.entries(headers).forEach(([k, v]) => { try { xhr.setRequestHeader(k, v); } catch(e) {} });
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        const status = xhr.status;
        const ok = status >= 200 && status < 300;
        const text = xhr.responseText;
        resolve({ ok, status, json: async () => { try { return JSON.parse(text || '{}'); } catch(e){ return {}; } } });
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    } catch (err) { reject(err); }
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
  <motion.div className={`modal-content ${compactForRole ? 'compact-form' : ''} ${isProfile ? 'profile-modal' : ''} ${!isProfile ? 'edit-sized' : ''} ${(isAddViewer || isAddServerAdmin) ? 'add-viewer-wide' : ''} ${isProfile && isEdit && form.role === 'ADMIN' ? 'admin-profile-edit' : ''}`} aria-busy={saving ? 'true' : 'false'} initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={e => e.stopPropagation()}>
            {showToast && (
              <div className="save-toast" role="status" aria-live="polite">Profile updated</div>
            )}
            {errorToast && (
              <div className="error-toast" role="alert" aria-live="assertive">{errorToast}</div>
            )}
            {saving && (
              // use the modal-level busy overlay (non-blocking pointer-events) so we don't stop hover/animations
              <div className="modal-busy-overlay" aria-hidden>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" />
                  <div className="label">Saving...</div>
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="modal-form">
              {/* indicate the form is busy while saving for assistive tech */}
              <div aria-hidden style={{ display: 'none' }} />
              <div className="modal-header">
                <div className="avatar-preview">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="avatar preview" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }} aria-hidden>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                      </svg>
                    </div>
                  )}
                  {/* camera-style button overlay for both add and edit: open avatar editor modal */}
                  <button type="button" className="avatar-camera-btn" title={isEdit ? "Change profile picture" : "Add profile picture"} aria-label={isEdit ? "Change profile picture" : "Add profile picture"} onClick={() => setShowAvatarEditor(true)}>
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" focusable="false">
                      <path d="M4 7H6L7 5H17L18 7H20C21.1 7 22 7.9 22 9V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V9C2 7.9 2.9 7 4 7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <circle cx="12" cy="14" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                  </button>
                </div>
                <div className="modal-title">
                  {(() => {
                    // Explicit sentence-case mapping for roles
                    const roleTitle = (
                      form.role === 'SERVER_ADMIN' ? 'Server Admin'
                      : form.role === 'ADMIN' ? 'Admin'
                      : 'Viewer'
                    );
                    const nameTitle = form.display_name || form.username || '';
                    // Ensure action word is leading-capital only
                    const action = isEdit ? 'Edit' : 'Add';
                    if (isProfile && isEdit) {
                      // Profile modal: show only "Edit [role]:" in the header line, and name as a secondary header below the divider
                      return (
                        <>
                          <h3>{`${action} ${roleTitle}:`}</h3>
                          <div className="modal-subtitle" title={nameTitle}>{nameTitle}</div>
                        </>
                      );
                    }
                    // Default behavior for non-profile editor modal: single-line header includes the name
                    return (
                      <h3>{isEdit ? `${action} ${roleTitle}: ${nameTitle}` : `${action} ${roleTitle}`}</h3>
                    );
                  })()}
                  {isEdit && !hideRoleAndReset && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <button type="button" className="reset-btn header-reset-btn" onClick={() => setShowReset(s => !s)}>
                        <FaKey style={{ marginRight: '0.45rem' }} aria-hidden />
                        {showReset ? 'Cancel Reset' : 'Reset Password'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Display Name</label>
                <input name="display_name" value={form.display_name} onChange={handleChange} required />
              </div>
              {!isEdit && (
                <>
                  <div className="form-group">
                    <label>Username</label>
                    <input name="username" value={form.username} onChange={handleChange} required />
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <input type="password" name="password" value={form.password} onChange={handleChange} required />
                  </div>
                </>
              )}
              {isEdit && !isProfile && (
                <div className="form-group">
                  <label>Username</label>
                  <input name="username" value={form.username} onChange={handleChange} required />
                </div>
              )}
              {/* Role: editable for admins and when not editing your own non-admin profile; otherwise render read-only */}
              { !hideRoleAndReset ? (
                <div className="form-group">
                  <label>Role</label>
                  <select name="role" value={form.role} onChange={handleChange}>
                    <option value="VIEWER">VIEWER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="SERVER_ADMIN">SERVER ADMIN</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label>Role</label>
                  <div style={{ padding: '0.6rem 0.8rem', borderRadius: 6, background: 'transparent', color: '#cfd8dc' }}>{form.role === 'SERVER_ADMIN' ? 'SERVER ADMIN' : form.role}</div>
                </div>
              )}

              {form.role !== 'ADMIN' && (
                <div className="form-group permissions-group">
                  <label>Server Permissions</label>
                  {hideRoleAndReset ? (
                    // read-only list for profile modal when viewing own account as VIEWER or SERVER_ADMIN
                    <div className="readonly-servers-list">
                      {selectedServers && selectedServers.length ? (
                        <ul>
                          {selectedServers.map(id => {
                            const s = servers.find(x => x.id === id);
                            const label = s ? s.server_name : `Server #${id}`;
                            return (
                              <li key={id}>
                                <FaServer className="server-icon" aria-hidden />
                                <span>{label}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="muted">No server access</div>
                      )}
                    </div>
                  ) : (
                    <div className="permissions-grid">
                      {servers.map(s => (
                        <label key={s.id} className="permission-label">
                          <input type="checkbox" name="server" value={s.id} checked={selectedServers.includes(s.id)} onChange={handleChange} />
                          <span>{s.server_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Server admin assignments are applied automatically when role === SERVER_ADMIN */}

              {/* Avatar file input moved into the avatar editor modal; camera button opens the modal for both add and edit */}

              {isEdit && !hideRoleAndReset && (
                <>
                  {showReset && (
                    <div className="form-group">
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column' }}>
                        <input type="password" placeholder="New password (min 6 chars)" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
                        <input type="password" placeholder="Confirm new password" value={resetPasswordConfirm} onChange={e => setResetPasswordConfirm(e.target.value)} style={{ marginTop: '0.4rem' }} />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={onClose} disabled={saving} aria-busy={saving ? 'true' : 'false'}>Cancel</button>
                <button type="submit" className="submit-btn" disabled={saving} aria-busy={saving ? 'true' : 'false'}>{saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create')}</button>
              </div>
            </form>
            {/* Avatar editor modal (small) opened via camera button in edit mode */}
            <Modal isOpen={showAvatarEditor} onClose={() => setShowAvatarEditor(false)} title="Update Profile Picture" compact busy={saving}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexDirection: 'column' }}>
                <input id="avatar-edit" type="file" accept="image/*" onChange={(e) => { handleAvatar(e); }} />
                {avatarPreview ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div className="avatar-preview"><img src={avatarPreview} alt="avatar preview" /></div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button type="button" className="btn-link" onClick={() => { setAvatarPreview(null); setAvatarFile(null); setClearAvatar(true); }}>Remove</button>
                      <button type="button" className="btn-link" onClick={() => setShowAvatarEditor(false)}>Done</button>
                    </div>
                  </div>
                ) : (
                  <div className="avatar-preview" style={{ background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }} aria-hidden>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </div>
            </Modal>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
