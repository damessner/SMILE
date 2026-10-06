import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../components/Toast';
import { ConfirmProvider, useConfirm } from '../components/ConfirmDialog';

function Probe() {
  return <p role="status">harness ok</p>;
}

describe('client test harness', () => {
  it('renders a React component with testing-library matchers', () => {
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('harness ok');
  });

  // The components this harness exists for call both `useToast()` and
  // `useConfirm()`, and each hook throws outside its provider. Prove the nesting
  // works here so a later test does not have to discover it by crashing.
  it('renders a component that uses both context hooks', () => {
    function ContextConsumer() {
      useToast();
      useConfirm();
      return <p role="status">providers ok</p>;
    }
    render(
      <ToastProvider>
        <ConfirmProvider>
          <ContextConsumer />
        </ConfirmProvider>
      </ToastProvider>,
    );
    // The toast viewport is itself a `role="status"` landmark, so the text is
    // matched rather than the role.
    expect(screen.getByText('providers ok')).toBeInTheDocument();
  });
});
