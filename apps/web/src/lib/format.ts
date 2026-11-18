const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatDate = (iso: string) =>
  // Datas puras (YYYY-MM-DD) não podem sofrer fuso horário.
  iso.length === 10 ? iso.split('-').reverse().join('/') : dateFmt.format(new Date(iso));

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
