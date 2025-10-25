import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaCog, FaTrashAlt, FaClock, FaEllipsisV } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';

const getUserStatus = (expireDate) => {
  const now = new Date();
  const expiry = new Date(expireDate);
  const msDiff = expiry - now;
  const hoursDiff = msDiff / (1000 * 60 * 60);
  if (hoursDiff < 0) return { text: 'Expired', className: 'status-expired' };
  // Expire Soon is now defined as <= 24 hours
  if (hoursDiff <= 24) return { text: 'Expire Soon', className: 'status-soon' };
  return { text: 'Active', className: 'status-active' };
};

const formatDuration = (expireDate) => {
    const now = new Date();
    const expiry = new Date(expireDate);
    let diff = expiry - now;
    if (diff < 0) return '0d 0h';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    diff -= days * (1000 * 60 * 60 * 24);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    return `${days}d ${hours}h`;
};

function UserTable({ users, onEdit, onDelete, onQuickRenew, canManageUsers = null }) {
  // determine role from localStorage as a fallback to AuthContext
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role || (localStorage.getItem('user') || null); } catch(e) { role = null; }
  const allowActions = canManageUsers !== null ? canManageUsers : (role === 'ADMIN');

  const [openRenewFor, setOpenRenewFor] = useState(null);
  const [openOverflowFor, setOpenOverflowFor] = useState(null);
  // map of refs for each row so outside-click detection works per-row
  const rowRefs = useRef({});
  // map of refs for popups rendered into a portal (so we can detect clicks inside them)
  const popupRefs = useRef({});
  // separate refs for overflow menus rendered into the portal
  const overflowRefs = useRef({});
  // store computed positions for portal popups so they can be absolutely positioned in viewport
  const popupPositions = useRef({});

  // ensure there's a single container for all portal popups
  const getPopupRoot = () => {
    if (typeof document === 'undefined') return null;
    let root = document.getElementById('portal-popups-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'portal-popups-root';
      document.body.appendChild(root);
    }
    return root;
  };

  // close renew box when clicking outside the currently open row
  useEffect(() => {
    function onDoc(e) {
      if (!openRenewFor) return;
      const currentRowEl = rowRefs.current && rowRefs.current[openRenewFor];
      const currentPopupEl = popupRefs.current && popupRefs.current[openRenewFor];
      // If click is inside the row or inside the portal popup, keep it open.
      if (currentRowEl && currentRowEl.contains(e.target)) return;
      if (currentPopupEl && currentPopupEl.contains(e.target)) return;
      setOpenRenewFor(null);
    }
    // use 'click' so target buttons receive their click handlers first
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [openRenewFor]);

  // outside-click handler for overflow menus
  useEffect(() => {
    function onDoc(e) {
      if (!openOverflowFor) return;
      const currentRowEl = rowRefs.current && rowRefs.current[openOverflowFor];
      const currentOverflowEl = overflowRefs.current && overflowRefs.current[openOverflowFor];
      if (currentRowEl && currentRowEl.contains(e.target)) return;
      if (currentOverflowEl && currentOverflowEl.contains(e.target)) return;
      setOpenOverflowFor(null);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [openOverflowFor]);

  return (
    <div className="user-table-container">
      <table className="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Service</th>
            <th>Duration</th>
            <th>Expire Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
              {users.map(user => {
              const status = getUserStatus(user.expire_date);
                // ensure there's a ref element for this row
                const ensureRef = (el) => { if (el) rowRefs.current[user.id] = el; };
              return (
                <motion.tr 
                    key={user.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ duration: 0.3 }}
                >
                  <td data-label="Name">
                    <div className="user-name-cell">
                      {user.account_name}
                      {user.remark && <span className="user-remark">{user.remark}</span>}
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className={`status-indicator ${status.className}`}></span>
                    {status.text}
                  </td>
                  <td data-label="Service">{user.service_type}</td>
                  <td data-label="Duration" title={`Expire: ${new Date(user.expire_date).toLocaleDateString('en-GB')}`}>{formatDuration(user.expire_date)}</td>
                  <td data-label="Expire Date">
                    {/* THIS LINE FIXES THE DATE FORMAT */}
                    {new Date(user.expire_date).toLocaleDateString('en-GB')}
                  </td>
                  <td data-label="Actions">
                    <div className="user-actions" ref={ensureRef}>
                      { allowActions ? (
                        <>
                          {/* Quick Renew toggle (left-most) */}
                          <div className="quick-renew-wrap">
                            <button
                              onClick={() => setOpenRenewFor(prev => prev === user.id ? null : user.id)}
                              className="icon-btn quick-renew-toggle"
                              title="Quick Renew"
                              aria-expanded={openRenewFor === user.id}
                            >
                              <FaClock />
                            </button>
                                          {openRenewFor === user.id && (() => {
                                            // compute position near the toggle button so the portal popup floats near it
                                            const rowEl = rowRefs.current && rowRefs.current[user.id];
                                            const toggleBtn = rowEl && rowEl.querySelector('.quick-renew-toggle');
                                            let style = { position: 'fixed', right: '12px', top: '64px' };
                                            try {
                                              if (toggleBtn) {
                                                const rect = toggleBtn.getBoundingClientRect();
                                                // prefer positioning to the right of the button when there's space, otherwise align to left edge
                                                const preferRight = window.innerWidth - rect.right > 180;
                                                const offsetTop = Math.max(12, rect.top - 6);
                                                if (preferRight) {
                                                  style = { position: 'fixed', left: `${rect.right + 8}px`, top: `${offsetTop}px` };
                                                } else {
                                                  // if not enough space on right, position above the button and align to right viewport
                                                  style = { position: 'fixed', right: '12px', top: `${offsetTop}px` };
                                                }
                                              }
                                            } catch (e) {
                                              // ignore measurement errors during SSR/tests
                                            }

                                            const popupRoot = getPopupRoot();
                                            const popup = (
                                              <div
                                                key={`qr-${user.id}`}
                                                ref={el => { if (el) popupRefs.current[user.id] = el; else delete popupRefs.current[user.id]; }}
                                                className="quick-renew-box"
                                                role="dialog"
                                                aria-label="Quick renew options"
                                                style={style}
                                              >
                                                <div className="quick-renew-title">Add (month)</div>
                                                <div className="quick-renew-actions">
                                                  <button className="quick-renew-btn" onClick={() => { console.debug('quick renew clicked', user.id, 1); onQuickRenew && onQuickRenew(user, 1); setOpenRenewFor(null); }}>1m</button>
                                                  <button className="quick-renew-btn" onClick={() => { console.debug('quick renew clicked', user.id, 2); onQuickRenew && onQuickRenew(user, 2); setOpenRenewFor(null); }}>2m</button>
                                                  <button className="quick-renew-btn" onClick={() => { console.debug('quick renew clicked', user.id, 3); onQuickRenew && onQuickRenew(user, 3); setOpenRenewFor(null); }}>3m</button>
                                                  <button className="quick-renew-btn" onClick={() => { console.debug('quick renew clicked', user.id, 6); onQuickRenew && onQuickRenew(user, 6); setOpenRenewFor(null); }}>6m</button>
                                                </div>
                                              </div>
                                            );
                                            return popupRoot ? createPortal(popup, popupRoot) : popup;
                                          })()}
                          </div>

                          <button onClick={() => onEdit(user)} className="icon-btn edit-btn"><FaCog /></button>
                          <button onClick={() => onDelete(user)} className="icon-btn delete-btn"><FaTrashAlt /></button>

                          {/* Overflow menu button for very small screens */}
                          <button
                            className="icon-btn overflow-btn"
                            title="More actions"
                            onClick={() => setOpenOverflowFor(prev => prev === user.id ? null : user.id)}
                            aria-expanded={openOverflowFor === user.id}
                          >
                            <FaEllipsisV />
                          </button>

                          {openOverflowFor === user.id && (() => {
                            const rowEl = rowRefs.current && rowRefs.current[user.id];
                            const overflowBtn = rowEl && rowEl.querySelector('.overflow-btn');
                            let style = { position: 'fixed', right: '12px', top: '64px' };
                            try {
                              if (overflowBtn) {
                                const rect = overflowBtn.getBoundingClientRect();
                                const offsetTop = Math.max(12, rect.top - 6);
                                style = { position: 'fixed', right: '12px', top: `${offsetTop}px` };
                              }
                            } catch (e) {}

                            const popupRoot = getPopupRoot();
                            const menu = (
                              <div
                                key={`ov-${user.id}`}
                                ref={el => { if (el) overflowRefs.current[user.id] = el; else delete overflowRefs.current[user.id]; }}
                                className="action-overflow-menu"
                                role="menu"
                                aria-label="More actions"
                                style={style}
                              >
                                <button className="overflow-item" onClick={() => { onEdit(user); setOpenOverflowFor(null); }} role="menuitem">Edit</button>
                                <button className="overflow-item" onClick={() => { onDelete(user); setOpenOverflowFor(null); }} role="menuitem">Delete</button>
                              </div>
                            );
                            return popupRoot ? createPortal(menu, popupRoot) : menu;
                          })()}
                        </>
                      ) : (
                        <span style={{ color: '#888' }}>No actions</span>
                      ) }
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

export default UserTable;

