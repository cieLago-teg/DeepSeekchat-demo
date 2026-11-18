import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16 } from './icons.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'start', alignOffset: -5, offset: 4 }
  )
  useDismiss(open, [anchorRef, floatingRef], close)
  useEffect(() => {
    if (open) {
      floatingRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
  }, [open, floatingRef])

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => setOpen((value) => !value) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
              onKeyDown={(event) => {
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                )
                const index = items.indexOf(document.activeElement as HTMLButtonElement)
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  items[
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  ]?.focus()
                } else if (event.key === 'Escape' || event.key === 'Tab') {
                  close()
                  anchorRef.current?.querySelector('button')?.focus()
                }
              }}
            >
              {options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role={option.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={option.checked}
                  disabled={option.disabled}
                  className={clsx(styles.option, option.danger && styles.danger)}
                  onClick={() => {
                    setOpen(false)
                    option.onSelect()
                    anchorRef.current?.querySelector('button')?.focus()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                  {option.checked ? <IconCheckOutline16 /> : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
