import { useEffect, useRef, useState } from 'react'

export type DropdownOption = { value: string | null; label: string }

type Props = {
  label: string
  ariaLabel: string
  title: string
  options: readonly DropdownOption[]
  value: string | null
  isChanged: boolean
  isDisabled: boolean
  onChange: (value: string | null) => void
}

export function Dropdown({ label, ariaLabel, title, options, value, isChanged, isDisabled, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [isOpen])

  return (
    <div className="dropdown" ref={root}>
      <button
        type="button"
        className={`picker ${isChanged ? 'changed' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={title}
        disabled={isDisabled}
        onClick={() => setIsOpen(current => !current)}
      >
        <span className="ellipsis">{label}</span>
        <span className="picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen && (
        <div className="dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map(option => (
            <button
              type="button"
              role="option"
              key={option.value ?? 'default'}
              aria-selected={option.value === value}
              className={`dropdown-item ${option.value === value ? 'selected' : ''}`}
              onClick={() => {
                setIsOpen(false)
                onChange(option.value)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
