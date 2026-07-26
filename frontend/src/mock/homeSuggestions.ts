import {
  CalendarDays,
  Gem,
  ShieldPlus,
  Vault,
} from 'lucide-react'

export const homeSuggestions = [
  {
    id: 'new-policy',
    icon: ShieldPlus,
    iconColor: '#EA8444',
    label: '新建保障',
    to: '/tasks/new',
  },
  {
    id: 'collection',
    icon: Gem,
    iconColor: '#4A90D9',
    label: 'NFT 藏品',
    to: '/collection',
  },
  {
    id: 'vault',
    icon: Vault,
    iconColor: '#4CAF50',
    label: '承保池',
    to: '/vault',
  },
  {
    id: 'schedule',
    icon: CalendarDays,
    iconColor: '#9C5EC7',
    label: '日程',
    to: '/schedule',
  },
] as const
