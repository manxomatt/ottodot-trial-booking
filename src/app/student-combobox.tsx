'use client'

import { useEffect, useRef, useState } from 'react'

export interface Student {
  id: string
  name: string
  grade: number
}

export interface Parent {
  id: string
  name: string
  email: string
  students: Student[]
}

interface StudentComboboxProps {
  parents: Parent[]
  selectedStudentId: string
  onSelect: (id: string) => void
  disabled?: boolean
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function StudentCombobox({
  parents,
  selectedStudentId,
  onSelect,
  disabled = false,
}: StudentComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Find currently selected student and their parent
  let selectedStudent: Student | null = null
  let selectedParent: Parent | null = null

  for (const p of parents) {
    const found = p.students.find((s) => s.id === selectedStudentId)
    if (found) {
      selectedStudent = found
      selectedParent = p
      break
    }
  }

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="combobox-container" ref={containerRef}>
      <button
        type="button"
        className={`combobox-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || parents.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="combobox-selected-info">
          {selectedStudent ? (
            <>
              <div className="avatar-circle">
                {getInitials(selectedStudent.name)}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{selectedStudent.name}</strong>
                  <span className="badge" style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
                    Primary {selectedStudent.grade} (P{selectedStudent.grade})
                  </span>
                </div>
                {selectedParent && (
                  <div className="meta" style={{ marginTop: 2 }}>
                    Parent: <strong>{selectedParent.name}</strong> ({selectedParent.email})
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="meta">Select a student profile...</span>
          )}
        </div>

        <div className={`combobox-chevron ${isOpen ? 'open' : ''}`}>
          ▼
        </div>
      </button>

      {isOpen && (
        <div className="combobox-dropdown" role="listbox">
          {parents.map((parent) => (
            <div key={parent.id} className="combobox-group">
              <div className="combobox-group-header">
                <span>Family of {parent.name}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{parent.email}</span>
              </div>

              {parent.students.map((student) => {
                const isSelected = student.id === selectedStudentId
                return (
                  <div
                    key={student.id}
                    className={`combobox-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelect(student.id)
                      setIsOpen(false)
                    }}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="combobox-item-left">
                      <div className="avatar-circle small">
                        {getInitials(student.name)}
                      </div>
                      <div>
                        <div style={{ fontWeight: isSelected ? 700 : 500, fontSize: 14 }}>
                          {student.name}
                        </div>
                        <div className="meta" style={{ fontSize: 12 }}>
                          Primary {student.grade} (P{student.grade})
                        </div>
                      </div>
                    </div>

                    {isSelected && (
                      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>
                        ✓
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
