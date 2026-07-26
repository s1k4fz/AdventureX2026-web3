import {
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import {
  AnimatePresence,
  motion,
  useUnitsMotion,
} from '@/lib/motion'
import { cn } from '@/lib/utils'

import './BubbleMenu.css'

export interface BubbleMenuItem {
  label: string
  href: string
  ariaLabel?: string
  hoverStyles?: { bgColor?: string; textColor?: string }
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void
}

export interface BubbleMenuProps {
  logo?: ReactNode
  onMenuClick?: (open: boolean) => void
  className?: string
  style?: CSSProperties
  menuAriaLabel?: string
  menuBg?: string
  menuContentColor?: string
  useFixedPosition?: boolean
  items?: BubbleMenuItem[]
}

const DEFAULT_ITEMS: BubbleMenuItem[] = [
  {
    label: '服务',
    href: '#services',
    ariaLabel: '服务',
    hoverStyles: {
      bgColor: 'var(--units-blue)',
      textColor: 'var(--units-on-accent)',
    },
  },
  {
    label: '流程',
    href: '#flow',
    ariaLabel: '流程',
    hoverStyles: {
      bgColor: 'var(--units-green)',
      textColor: 'var(--units-on-accent)',
    },
  },
  {
    label: '登录',
    href: '/login',
    ariaLabel: '登录',
    hoverStyles: {
      bgColor: 'var(--units-orange)',
      textColor: 'var(--units-on-accent)',
    },
  },
]

export default function BubbleMenu({
  logo,
  onMenuClick,
  className,
  style,
  menuAriaLabel = 'Toggle menu',
  menuBg = 'var(--units-soft)',
  menuContentColor = 'var(--units-black)',
  useFixedPosition = false,
  items,
}: BubbleMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { snap, soft, stagger, reduce, scaleFrom } = useUnitsMotion()
  const menuItems = items?.length ? items : DEFAULT_ITEMS

  const handleToggle = () => {
    const nextState = !isMenuOpen
    setIsMenuOpen(nextState)
    onMenuClick?.(nextState)
  }

  return (
    <>
      <nav
        className={cn(
          'bubble-menu',
          useFixedPosition ? 'fixed' : 'absolute',
          className
        )}
        style={style}
        aria-label="Main navigation"
      >
        <div
          className="bubble logo-bubble"
          aria-label="Logo"
          style={{ background: menuBg }}
        >
          <span className="logo-content">
            {typeof logo === 'string' ? (
              <img src={logo} alt="Logo" className="bubble-logo" />
            ) : (
              logo
            )}
          </span>
        </div>

        <button
          type="button"
          className={cn('bubble toggle-bubble menu-btn', isMenuOpen && 'open')}
          onClick={handleToggle}
          aria-label={menuAriaLabel}
          aria-pressed={isMenuOpen}
          style={{ background: menuBg }}
        >
          <span className="menu-line" style={{ background: menuContentColor }} />
          <span
            className="menu-line short"
            style={{ background: menuContentColor }}
          />
        </button>
      </nav>

      <AnimatePresence>
        {isMenuOpen ? (
          <motion.div
            className={cn(
              'bubble-menu-items',
              useFixedPosition ? 'fixed' : 'absolute'
            )}
            aria-hidden={false}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={snap}
          >
            <motion.ul
              className="pill-list"
              role="menu"
              aria-label="Menu links"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                hidden: {},
                visible: {
                  transition: { staggerChildren: stagger, delayChildren: 0.04 },
                },
              }}
            >
              {menuItems.map((item) => (
                <motion.li
                  key={item.href + item.label}
                  role="none"
                  className="pill-col"
                  variants={{
                    hidden: { opacity: 0, scale: scaleFrom, y: 10 },
                    visible: { opacity: 1, scale: 1, y: 0 },
                  }}
                  transition={soft}
                >
                  <a
                    role="menuitem"
                    href={item.href}
                    aria-label={item.ariaLabel || item.label}
                    className="pill-link"
                    onClick={(event) => {
                      item.onClick?.(event)
                      setIsMenuOpen(false)
                      onMenuClick?.(false)
                    }}
                    style={
                      {
                        '--pill-bg': menuBg,
                        '--pill-color': menuContentColor,
                        '--hover-bg':
                          item.hoverStyles?.bgColor ||
                          'color-mix(in srgb, var(--units-black) 6%, transparent)',
                        '--hover-color':
                          item.hoverStyles?.textColor || menuContentColor,
                      } as CSSProperties
                    }
                  >
                    <span className="pill-label">{item.label}</span>
                  </a>
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
