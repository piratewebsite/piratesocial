/**
 * Send a notification to a user and push via SSE if they're connected.
 */
export async function sendNotification(app, prisma, userId, type, data) {
  const notification = await prisma.notification.create({
    data: { userId, type, data },
  });

  // Push via SSE if user is connected
  const sseClients = app.locals.sseClients;
  const clients = sseClients?.get(userId);
  if (clients?.size > 0) {
    const payload = `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }

  return notification;
}
