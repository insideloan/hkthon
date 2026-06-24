import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/app/_components/Sidebar';

// Mock next/navigation so usePathname() works outside the Next.js runtime.
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}));

// Mock next/link — render as a plain <a> so RTL can find it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { usePathname } from 'next/navigation';

describe('Sidebar', () => {
  it('renders all 3 nav labels', () => {
    render(<Sidebar />);
    // Each label spans two lines; text content is the concatenation of both lines.
    // Use getAllByText for /상담/ since it appears in two items (AI 상담 화면 + 상담 CRM).
    expect(screen.getByText(/관리자/)).toBeInTheDocument();
    expect(screen.getByText(/AI 상담/)).toBeInTheDocument();
    expect(screen.getByText(/CRM/)).toBeInTheDocument();
    // All three items contain 상담 somewhere — assert at least 2 matches.
    expect(screen.getAllByText(/상담/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders brand name ㅎㅋ톡', () => {
    render(<Sidebar />);
    expect(screen.getByText('ㅎㅋ톡')).toBeInTheDocument();
  });

  it('renders 3 nav links', () => {
    render(<Sidebar />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
  });

  it('marks the root "/" item as active (aria-current=page) when pathname is "/"', () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/');
    render(<Sidebar />);
    const activeLinks = screen.getAllByRole('link', { current: 'page' });
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveAttribute('href', '/');
  });

  it('marks /calls item active when pathname starts with /calls', () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/calls/demo');
    render(<Sidebar />);
    const activeLinks = screen.getAllByRole('link', { current: 'page' });
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveAttribute('href', '/calls');
  });

  it('marks /crm item active when pathname starts with /crm', () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/crm/demo');
    render(<Sidebar />);
    const activeLinks = screen.getAllByRole('link', { current: 'page' });
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveAttribute('href', '/crm');
  });

  it('renders the LIVE footer dot', () => {
    render(<Sidebar />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });
});
