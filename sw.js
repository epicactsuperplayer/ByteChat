self.addEventListener('push', function(event) {
  const options = {
    body: 'You got an SMS from a Bytestorm Website',
    icon: '/icon.png', // Make sure you have an icon file in GitHub!
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {action: 'explore', title: 'View Message'}
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Bytestorm ByteChat', options)
  );
});
