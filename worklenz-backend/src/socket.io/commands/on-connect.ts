import {Server, Socket} from "socket.io";
import db from "../../config/db";

import {log} from "../util";
import {SocketEvents} from "../events";
import {getLoggedInUserIdFromSocket} from "../util";

export async function on_login(_io: Server, socket: Socket, _claimedId?: string) {
  log(socket.id, `user connected`);
  const userId = getLoggedInUserIdFromSocket(socket);
  if (!userId) {
    socket.disconnect(true);
    return;
  }
  try {
    const q = "UPDATE users SET socket_id = $1 WHERE id = $2::UUID";
    await db.query(q, [socket.id, userId]);
    socket.join(`staff:user:${userId}`);
    socket.emit(SocketEvents.LOGIN.toString());
  } catch (error) {
    // ignored
  }
}
