// 🗂️ ReMix Storage — a fájl-tár hibatípusa (HTTP-státusz + gépi kód) és a gyakori hibák.
class UserFilesError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'UserFilesError';
    this.status = status;
    this.code = code;
  }
}

const badPath = (msg) => new UserFilesError(400, 'bad_path', msg || 'Érvénytelen útvonal.');
const notFound = () => new UserFilesError(404, 'not_found', 'Nincs ilyen fájl vagy mappa.');

module.exports = { UserFilesError, badPath, notFound };
