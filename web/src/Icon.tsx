const PATHS = {
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  close: 'M6 6l12 12M18 6L6 18',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5.5v13l10.5-6.5L8 5.5z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5zM10 20.5a2.2 2.2 0 0 0 4 0',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  send: 'M4 11.5L20 4l-3.5 16-4.5-6-8-2.5zM12 14l8-10',
}

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
