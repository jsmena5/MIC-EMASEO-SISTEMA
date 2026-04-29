import { useEffect, useState } from "react"
import {
  getOperarios,
  deleteOperario
} from "../../../services/operarios.service"

import {
  getSupervisores,
  deleteSupervisor
} from "../../../services/supervisor.service"

const Users = () => {
  const [data, setData] = useState<any[]>([])
  const [tipo, setTipo] = useState<"operarios" | "supervisores">("operarios")
  const [message, setMessage] = useState("")

  // ===============================
  // LOAD DATA
  // ===============================
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

  // ===============================
  // DELETE
  // ===============================
  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro que quieres eliminar?")) return

    try {
      if (tipo === "operarios") {
        await deleteOperario(id)
      } else {
        await deleteSupervisor(id)
      }

      setMessage(" Eliminado correctamente")
      load()

      setTimeout(() => setMessage(""), 3000)
    } catch (error) {
      setMessage(" Error eliminando")
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Gestión de Usuarios</h1>

      {/* BOTONES TIPO TAB */}
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

      {/* MENSAJES */}
      {message && <div style={styles.message}>{message}</div>}

      {/* TABLA */}
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
          {data.map((u: any) => (
            <tr key={u.id}>
              <td>{u.nombre} {u.apellido}</td>
              <td>{u.cedula}</td>
              <td>{u.rol}</td>
              <td>
                <button
                  style={styles.deleteBtn}
                  onClick={() => handleDelete(u.id)}
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles: any = {
  container: {
    padding: "20px",
    fontFamily: "Arial"
  },
  title: {
    textAlign: "center",
    marginBottom: "20px"
  },
  tabs: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "20px"
  },
  tab: {
    padding: "10px 20px",
    border: "none",
    background: "#ccc",
    cursor: "pointer",
    borderRadius: "8px"
  },
  activeTab: {
    padding: "10px 20px",
    border: "none",
    background: "#007bff",
    color: "#fff",
    cursor: "pointer",
    borderRadius: "8px"
  },
  message: {
    textAlign: "center",
    marginBottom: "15px",
    fontWeight: "bold"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse"
  },
  deleteBtn: {
    background: "red",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    cursor: "pointer",
    borderRadius: "5px"
  }
}
export default Users

