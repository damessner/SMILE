import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Probe() {
  return <p role="status">harness ok</p>;
}

describe('client test harness', () => {
  it('renders a React component with testing-library matchers', () => {
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('harness ok');
  });
});
