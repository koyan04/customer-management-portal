import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronDown } from 'react-icons/fa';

/**
 * GlassSelect
 * Props:
 * - value: string | number | null
 * - onChange: (newValue) => void
 * - options: Array<{ value: string|number, label: string }>
 * - placeholder?: string
 * - className?: string (applied to wrapper)
 * - buttonClassName?: string
 * - menuClassName?: string
 * - disabled?: boolean
 * - ariaLabel?: string
 */
export default function GlassSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  disabled = false,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapperRef = useRef(null);
  const btnRef = useRef(null);
  const listboxId = useMemo(() => `gs-listbox-${Math.random().toString(36).slice(2)}`,[ ]);

  const indexByValue = useMemo(() => options.findIndex(o => o.value === value), [options, value]);
  const label = useMemo(() => {
    const idx = options.findIndex(o => o.value === value);
    return idx >= 0 ? options[idx].label : placeholder;
  }, [options, value, placeholder]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      // When opening, highlight the current value
      setHighlight(indexByValue >= 0 ? indexByValue : 0);
    }
  }, [open, indexByValue]);

  const moveHighlight = (delta) => {
    setHighlight(prev => {
      const len = options.length;
      if (len === 0) return -1;
      let next = prev;
      if (next < 0) next = indexByValue >= 0 ? indexByValue : 0;
      next = (next + delta + len) % len;
      return next;
    });
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // open
    if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setHighlight(0); }
    else if (e.key === 'End') { e.preventDefault(); setHighlight(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (highlight >= 0 && highlight < options.length) {
        onChange && onChange(options[highlight].value);
        setOpen(false);
        btnRef.current?.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    }
  };

  return (
    <div className={`glass-select ${className}`} ref={wrapperRef}>
      <button
        type="button"
        ref={btnRef}
        className={`glass-select-button ${buttonClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="glass-select-label">{label}</span>
        <FaChevronDown className="glass-select-caret" aria-hidden />
      </button>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className={`glass-select-menu ${menuClassName}`}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {options.map((opt, idx) => {
            const selected = value === opt.value;
            const highlighted = idx === highlight;
            return (
              <li
                key={String(opt.value)}
                role="option"
                aria-selected={selected}
                className={`glass-select-option${selected ? ' selected' : ''}${highlighted ? ' highlighted' : ''}`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); }}
                onClick={() => { onChange && onChange(opt.value); setOpen(false); btnRef.current?.focus(); }}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
