import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import {
  getOperarios,
  deleteOperario
} from "../../../services/operarios.service"
import {
  getSupervisores,
  deleteSupervisor
} from "../../../services/supervisor.service"

interface User {
  id: string
  nombre: string
  apellido: string
  cedula: string
  rol: string
}

const Users = () => {
  const [data, setData] = useState<User[]>([])
  const [tipo, setTipo] = useState<"operarios" | "supervisores">("operarios")
  const [message, setMessage] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res =
        tipo === "operarios"
          ? await getOperarios()
          : await getSupervisores()
      setData(res)
    } catch (error) {
      setMessage("Error cargando datos")
    }
  }

  useEffect(() => {
    load()
  }, [tipo])

  const requestDelete = (id: string) => setConfirmId(id)

  const confirmDelete = async () => {
    if (!confirmId) return
    const id = confirmId
    setConfirmId(null)
    try {
      if (tipo === "operarios") {
        await deleteOperario(id)
      } else {
        await deleteSupervisor(id)
      }
      setMessage("Eliminado correctamente")
      load()
      setTimeout(() => setMessage(""), 3000)
    } catch (error) {
      setMessage("Error eliminando")
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Gestión de Usuarios</h1>

      <div style={styles.tabs}>
        <button
          style={tipo === "operarios" ? styles.activeTab : styles.tab}
          onClick={() => setTipo("operarios")}
        >
          Operarios
        </button>
        <button
          style={tipo === "supervisores" ? styles.activeTab : styles.tab}
          onClick={() => setTipo("supervisores")}
        >
          Supervisores
        </button>
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Cédula</th>
            <th>Rol</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre} {u.apellido}</td>
              <td>{u.cedula}</td>
              <td>{u.rol}</td>
              <td>
                <button
                  style={styles.deleteBtn}
                  onClick={() => requestDelete(u.id)}
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirmId && (
        <div style={styles.overlay}>
          <div style={styles.dialog}>
            <p style={styles.dialogText}>¿Eliminar este usuario? Esta acción no se puede deshacer.</p>
            <div style={styles.dialogActions}>
              <button style={styles.cancelBtn} onClick={() => setConfirmId(null)}>
                Cancelar
              </button>
              <button style={styles.confirmBtn} onClick={confirmDelete}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    padding: "20px",
    fontFamily: "Arial",
  },
  title: {
    textAlign: "center",
    marginBottom: "20px",
  },
  tabs: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "20px",
  },
  tab: {
    padding: "10px 20px",
    border: "none",
    background: "#ccc",
    cursor: "pointer",
    borderRadius: "8px",
  },
  activeTab: {
    padding: "10px 20px",
    border: "none",
    background: "#007bff",
    color: "#fff",
    cursor: "pointer",
    borderRadius: "8px",
  },
  message: {
    textAlign: "center",
    marginBottom: "15px",
    fontWeight: "bold",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  deleteBtn: {
    background: "#dc3545",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    cursor: "pointer",
    borderRadius: "5px",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    background: "#fff",
    borderRadius: "8px",
    padding: "28px 32px",
    minWidth: "320px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
  },
  dialogText: {
    margin: "0 0 20px",
    fontSize: "15px",
    textAlign: "center",
  },
  dialogActions: {
    display: "flex",
    justifyContent: "center",
    gap: "12px",
  },
  cancelBtn: {
    padding: "8px 20px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    background: "#fff",
    cursor: "pointer",
    fontSize: "14px",
  },
  confirmBtn: {
    padding: "8px 20px",
    border: "none",
    borderRadius: "6px",
    background: "#dc3545",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
  },
}

export default Users
