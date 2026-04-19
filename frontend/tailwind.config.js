/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        base: '#0B0D17',
        surface: '#13162B',
        card: '#1A1F3A',
        border: '#2A2F52',
        accent: '#7B61FF',
        fuchsia: '#E040FB',
        teal: '#00D4AA',
        muted: '#8B92B8',
        text: '#E8EAFF',
      },
      boxShadow: {
        'glow-accent': '0 0 40px rgba(123, 97, 255, 0.25)',
        'glow-teal': '0 0 40px rgba(0, 212, 170, 0.2)',
        'glow-fuchsia': '0 0 40px rgba(224, 64, 251, 0.2)',
        card: '0 4px 24px rgba(0,0,0,0.4)',
      },
      keyframes: {
        'whoami-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'whoami-shake': 'whoami-shake 0.38s ease-in-out',
      },
    },
  },
}
