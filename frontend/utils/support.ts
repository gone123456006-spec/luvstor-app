import { apiRequest } from './api';

export type SupportTicket = {
  id?: string;
  ticketNumber: string;
  category: string;
  subject: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string | null;
  description?: string;
  message?: string;
};

export async function submitSupportTicket(
  token: string,
  payload: { category: string; subject: string; description: string },
): Promise<SupportTicket> {
  return apiRequest('/api/support/tickets', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listMySupportTickets(token: string): Promise<SupportTicket[]> {
  const data = await apiRequest('/api/support/tickets', token);
  return Array.isArray(data?.tickets) ? data.tickets : [];
}
