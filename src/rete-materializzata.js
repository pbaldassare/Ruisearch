// Ricostruisce la rete A/B/E unica (I e II livello) e la salva in tabella.

export async function ricostruisciRete(client) {
  const { rows } = await client.query('select archi, soggetti from ricostruisci_rete_collegati()');
  return rows[0];
}

export async function statoRete(client) {
  const { rows } = await client.query(
    `select ricostruita_il, archi, soggetti from rete_stato where id = 1`,
  );
  return rows[0] || null;
}
