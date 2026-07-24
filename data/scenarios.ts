
import React from 'react';
import { Level, TextType } from '../types';
import {
    // Generic Icons
    MapPin, Hand, HelpCircle, AlertCircle, AlertTriangle, MessageCircle, Heart, Angry, Search, Smile, Zap, DollarSign, Frown, Scale, Star, ThumbsUp, ThumbsDown, Camera,
    // Scenario Specific Icons
    Coffee, Bed, Car, ShoppingBag, Train, Home, Pill, Plane, Utensils, Bus, School, Landmark,
    Stethoscope, ShieldAlert, Briefcase, Wallet, Wrench, Dumbbell, Key, Scissors, Phone, Laptop,
    Palette, Gavel, FlaskConical, Globe, Wine, Mic, Brain, Tv, Drama, Ghost, Rocket, Megaphone, Sun, Umbrella, Music,
    // Action Icons
    Ticket, Receipt, Menu, Wifi, Clock, Lock, Thermometer, BriefcaseBusiness, UserPlus, FileWarning, Gift, Sparkles, AlertOctagon, Euro, CreditCard, Map, Flag, Download,
    // Missing Icons Fix
    Check, X, TrendingUp, CheckCircle, FileText, Ban, Apple, DoorOpen, Server, Lightbulb, BatteryLow, PieChart, Eye, Watch, GraduationCap,
    // New Additions
    Stamp, Popcorn, Building, HeartHandshake, Baby, Dog, Hammer, Film, BookOpen, Siren, Headphones, Guitar, Newspaper, Tent, Hash,
    ArrowRight, Calendar, Droplet, FireExtinguisher, Leaf, LineChart, ListChecks, Moon, PiggyBank, Recycle, Shirt, Ship, Trash2, TreePine, Truck,
    // New Additions v2 (redesign)
    Users, Radio, Handshake, Percent, Package, Cloud, Wind, Waves, Bell, Coins, Mail, Send, Vote, Building2, Volume2, Navigation, Sprout, Trophy, HandCoins, Fuel, Feather
} from 'lucide-react';

export interface ScenarioAction {
    label: string;
    value: string; // The specific prompt for the AI
    icon: React.ElementType;
}

export interface ScenarioContext {
    label: string;
    value: string; // The physical setting description
    registerInstruction: string; // Precise register/formality guidance for the scenario
    icon: React.ElementType;
    actions: ScenarioAction[]; // CHILDREN ACTIONS specific to this place
}

/**
 * CATÁLOGO DE ESCENARIOS (rediseño CEFR, panhispánico).
 *
 * Ejes: TextType (formato) -> Level (nivel) -> ScenarioContext (lugar/tema) -> ScenarioAction (situación).
 *
 * Criterio por nivel (habilidad de escucha que entrena):
 *  - A0 (Intro): keyword spotting. Solo Diálogo y Radio. Habla nativa con UN dato literal sembrado
 *    (número, hora, precio, deletreo, dirección, código). Situaciones transaccionales cortas.
 *  - A1-A2 (Beginner): recall simple. Presente/pretérito básico, vocabulario frecuente, funciones cotidianas.
 *  - B1-B2 (Intermediate): inferencia ligera. Narración, opinión, resolución de problemas, discurso conectado.
 *  - C1 (Advanced): matiz y registro. Ironía, subtexto, argumentación compleja, jerga, especialización.
 *
 * IMPORTANTE (regionalidad): el contenido es NEUTRO / panhispánico. No fija moneda, tratamiento (tú/vos/usted)
 * ni léxico local: la variante regional la impone el ACENTO elegido (ver DIALECT_PROFILES + regla LOCALIZE en
 * services/geminiService.ts). No hardcodear €, DNI, "piso", lunfardo, etc.
 *
 * Podcast y Monólogo (narrativos) NO tienen A0 (por eso el nivel es Partial<Record<Level, ...>>).
 * Todo escenario de Diálogo es una interacción de EXACTAMENTE 2 personas (nunca implica un tercero).
 */
export const SCENARIO_DATABASE: Record<TextType, Partial<Record<Level, ScenarioContext[]>>> = {
    [TextType.Dialogue]: {
        [Level.Intro]: [
            {
                label: "Datos de Contacto",
                value: "Dos personas intercambian datos personales en un entorno con ruido de fondo",
                registerInstruction: "Registro social informal y cortés. Frases breves para pedir, confirmar y repetir datos. Sin jerga fuerte, insultos ni bromas.",
                icon: Phone,
                actions: [
                    { label: "Número de Teléfono", value: "Una persona dicta su número de teléfono dígito por dígito y la otra lo repite para confirmar.", icon: Hash },
                    { label: "Correo Electrónico", value: "Dictar un correo electrónico usando 'arroba', 'punto' y 'guion bajo'.", icon: Mail },
                    { label: "Usuario en Redes", value: "Preguntar el usuario en redes y deletrearlo letra por letra.", icon: Search },
                    { label: "Confirmar el Número", value: "Repetir un número dictado y corregir un dígito equivocado.", icon: Phone }
                ]
            },
            {
                label: "Recepción de Hotel",
                value: "Mostrador de recepción de un hotel durante el registro de entrada",
                registerInstruction: "Registro formal de atención al cliente. Tratamiento de respeto; fórmulas de cortesía. Sin coloquialismos, jerga ni sarcasmo.",
                icon: Bed,
                actions: [
                    { label: "Deletrear el Apellido", value: "El recepcionista no entiende el apellido y pide deletrearlo letra por letra.", icon: FileText },
                    { label: "Número de Habitación", value: "Asignar una habitación (por ejemplo 304) e indicar el piso.", icon: Key },
                    { label: "Hora del Desayuno", value: "Informar el horario exacto del desayuno (por ejemplo de 7:30 a 10:00).", icon: Clock },
                    { label: "Clave del Wifi", value: "Dictar la clave del wifi con letras y números, deletreando lo dudoso.", icon: Wifi }
                ]
            },
            {
                label: "Caja / Pagar",
                value: "Caja de una tienda al momento de cobrar, con ruido de fondo",
                registerInstruction: "Registro de servicio en caja: formal neutro. Confirmaciones de precio y cambio. Sin jerga ni bromas.",
                icon: Wallet,
                actions: [
                    { label: "Precio Total", value: "El cajero dice el precio total con decimales y el cliente busca el cambio.", icon: DollarSign },
                    { label: "Talla del Producto", value: "Pedir una talla o número específico (38, 42, XL) y preguntar si hay.", icon: ShoppingBag },
                    { label: "Días para Devolver", value: "Preguntar el número exacto de días que hay para devolver (por ejemplo 15 o 30 días).", icon: Calendar },
                    { label: "Número de Pedido", value: "Dictar el número de pedido o de ticket para una consulta.", icon: Receipt }
                ]
            },
            {
                label: "Taxi / Transporte",
                value: "En la calle o dentro de un taxi, con ruido de tráfico",
                registerInstruction: "Registro urbano funcional y cortés. Instrucciones directas. Evitar jerga muy marcada, insultos y chistes.",
                icon: Car,
                actions: [
                    { label: "Dirección Exacta", value: "Decir al conductor la calle y el número exacto del destino.", icon: MapPin },
                    { label: "Número de Línea", value: "Preguntar qué número de autobús va al centro (el 24, el 132).", icon: Bus },
                    { label: "Tiempo de Llegada", value: "Preguntar cuántos minutos faltan para llegar.", icon: Watch },
                    { label: "Precio de la Carrera", value: "Preguntar cuánto cuesta el viaje y confirmar el importe.", icon: Coins }
                ]
            },
            {
                label: "Turno / Cita",
                value: "Reservar por teléfono o en un mostrador administrativo",
                registerInstruction: "Registro administrativo formal. Lenguaje preciso para fechas y horarios. Sin coloquialismos ni familiaridad.",
                icon: Calendar,
                actions: [
                    { label: "Reservar una Hora", value: "Acordar una cita para un día específico a una hora concreta.", icon: Clock },
                    { label: "Fecha de Nacimiento", value: "Dar la fecha de nacimiento (día, mes y año) para un formulario.", icon: Calendar },
                    { label: "Código Postal", value: "Dictar el código postal de la dirección dígito por dígito.", icon: Hash },
                    { label: "Número de Documento", value: "Dictar el número del documento de identidad para el registro.", icon: FileText }
                ]
            },
            {
                label: "En la Farmacia",
                value: "Mostrador de una farmacia atendiendo a un cliente",
                registerInstruction: "Registro de atención sanitaria: formal y claro. Instrucciones precisas de dosis y horarios. Sin jerga ni bromas.",
                icon: Pill,
                actions: [
                    { label: "La Dosis", value: "Indicar cada cuántas horas tomar el medicamento y cuántas veces al día.", icon: Clock },
                    { label: "Precio del Medicamento", value: "Decir el precio del medicamento con decimales y cobrar.", icon: DollarSign },
                    { label: "Deletrear el Nombre", value: "Deletrear el nombre del medicamento porque no se entiende.", icon: FileText },
                    { label: "Horario de Guardia", value: "Informar el horario exacto de la farmacia de guardia.", icon: Clock }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Café / Restaurante",
                value: "Un cliente y un camarero en una cafetería o restaurante con ruido de fondo",
                registerInstruction: "Registro de atención cortés y semiformal. Peticiones claras. Evitar jerga fuerte o insultos.",
                icon: Coffee,
                actions: [
                    { label: "Pedir la Cuenta", value: "El cliente pide la cuenta y pregunta si aceptan tarjeta.", icon: Receipt },
                    { label: "Reclamar Comida Fría", value: "El plato llegó frío y el cliente pide cambiarlo con amabilidad.", icon: AlertCircle },
                    { label: "Preguntar Ingredientes", value: "Preguntar qué lleva un plato por alergia o por gusto.", icon: Menu },
                    { label: "Pedir Recomendación", value: "No sabe qué pedir y pregunta al camarero qué está bueno.", icon: HelpCircle },
                    { label: "Preguntar por el Baño", value: "Preguntar educadamente dónde está el baño.", icon: MapPin },
                    { label: "Pedir para Llevar", value: "Sobró comida y pide un recipiente para llevársela.", icon: ShoppingBag }
                ]
            },
            {
                label: "Mercado / Verdulería",
                value: "Un puesto de frutas y verduras al aire libre",
                registerInstruction: "Registro informal pero respetuoso; trato cercano. Regateo amable permitido. Sin insultos.",
                icon: Apple,
                actions: [
                    { label: "Preguntar el Precio", value: "Preguntar a cuánto están las naranjas hoy.", icon: DollarSign },
                    { label: "Pedir Fruta Madura", value: "Pedir aguacates que estén listos para comer hoy.", icon: Hand },
                    { label: "Regatear un Poco", value: "Intentar bajar el precio de forma amable.", icon: TrendingUp },
                    { label: "Origen del Producto", value: "Preguntar si los tomates son de la zona o de fuera.", icon: Globe },
                    { label: "Pedir Cambio", value: "Solo tiene un billete grande y necesita cambio.", icon: Coins },
                    { label: "Horario del Puesto", value: "Preguntar qué días está el mercado.", icon: Clock }
                ]
            },
            {
                label: "Tienda de Ropa",
                value: "Interior de una tienda de ropa con un dependiente",
                registerInstruction: "Registro de atención cortés. Peticiones directas y sencillas. Sin jerga.",
                icon: Shirt,
                actions: [
                    { label: "Pedir Otra Talla", value: "La prenda no le queda y pide una talla diferente.", icon: ShoppingBag },
                    { label: "Buscar los Probadores", value: "Preguntar dónde están los probadores para probarse algo.", icon: DoorOpen },
                    { label: "Preguntar el Precio", value: "Preguntar cuánto cuesta una prenda sin etiqueta visible.", icon: DollarSign },
                    { label: "Otro Color", value: "Pregunta si tienen la misma prenda en otro color.", icon: Palette },
                    { label: "Envolver para Regalo", value: "Pide que le envuelvan la compra para regalo.", icon: Gift },
                    { label: "Pagar en Caja", value: "Llevar la prenda a la caja y elegir cómo pagar.", icon: CreditCard }
                ]
            },
            {
                label: "Cine / Entradas",
                value: "Taquilla o mostrador de un cine",
                registerInstruction: "Registro de ventanilla, formal neutro. Frases cortas y directas. Sin bromas excesivas.",
                icon: Film,
                actions: [
                    { label: "Comprar Entradas", value: "Pedir dos entradas para la función de la tarde.", icon: Ticket },
                    { label: "Elegir Asientos", value: "Prefiere sentarse atrás o junto al pasillo.", icon: UserPlus },
                    { label: "Combo de Palomitas", value: "Pedir palomitas grandes y una bebida sin hielo.", icon: Popcorn },
                    { label: "Versión Original", value: "Preguntar si la película es subtitulada o doblada.", icon: MessageCircle },
                    { label: "Buscar la Sala", value: "Preguntar dónde queda la sala indicada en la entrada.", icon: HelpCircle },
                    { label: "Descuento", value: "Preguntar si hay descuento para estudiantes.", icon: Percent }
                ]
            },
            {
                label: "Pedir Indicaciones",
                value: "Dos personas en la calle: alguien perdido pregunta a un transeúnte",
                registerInstruction: "Registro cortés entre desconocidos. Instrucciones espaciales sencillas. Sin jerga marcada.",
                icon: MapPin,
                actions: [
                    { label: "Cómo Llegar", value: "Preguntar cómo llegar a un museo cercano a pie.", icon: Navigation },
                    { label: "Buscar el Metro", value: "Preguntar dónde está la estación de metro más cercana.", icon: Train },
                    { label: "Está Lejos o Cerca", value: "Preguntar si se puede ir andando o conviene el transporte.", icon: Watch },
                    { label: "Preguntar la Hora", value: "Preguntar la hora a alguien en la calle.", icon: Clock },
                    { label: "Parada de Taxi", value: "Preguntar dónde puede tomar un taxi.", icon: Car },
                    { label: "Sacar una Foto", value: "Pedir a alguien que le saque una foto y explicar cómo.", icon: Camera }
                ]
            },
            {
                label: "Estación / Transporte",
                value: "Mostrador o andén de una estación de tren o autobús",
                registerInstruction: "Registro funcional y cortés. Vocabulario de viaje frecuente. Sin coloquialismos fuertes.",
                icon: Train,
                actions: [
                    { label: "Comprar un Billete", value: "Comprar un billete de ida para el próximo tren.", icon: Ticket },
                    { label: "Preguntar el Andén", value: "Preguntar de qué andén sale su tren.", icon: MapPin },
                    { label: "Preguntar el Retraso", value: "Preguntar por qué el tren viene con retraso y cuánto.", icon: Clock },
                    { label: "Objeto Perdido", value: "Reportar que olvidó una mochila en el vagón.", icon: Search },
                    { label: "Cambiar de Horario", value: "Pedir cambiar el billete a un horario más tarde.", icon: ArrowRight },
                    { label: "Usar la Máquina", value: "Pedir ayuda para sacar el billete en la máquina.", icon: CreditCard }
                ]
            },
            {
                label: "Hotel (Recepción)",
                value: "Recepción de hotel atendiendo a un huésped ya alojado",
                registerInstruction: "Registro formal de atención al cliente. Fórmulas de cortesía. Sin jerga ni sarcasmo.",
                icon: Bed,
                actions: [
                    { label: "Hacer el Registro", value: "Registrarse con una reserva a nombre del huésped.", icon: FileText },
                    { label: "Problema con el Aire", value: "El aire acondicionado no funciona y pide ayuda.", icon: Thermometer },
                    { label: "Pedir un Taxi", value: "Pedir en recepción que le llamen un taxi para cierta hora.", icon: Car },
                    { label: "Dejar las Maletas", value: "Pedir dejar las maletas después de dejar la habitación.", icon: Package },
                    { label: "Pedir Toallas", value: "Pedir toallas limpias adicionales a la habitación.", icon: Hand },
                    { label: "Servicio Despertador", value: "Pedir que le despierten a una hora concreta.", icon: Bell }
                ]
            },
            {
                label: "Consultorio / Turno",
                value: "Recepción de un centro de salud gestionando un turno",
                registerInstruction: "Registro de atención sanitaria, cortés y claro. Vocabulario básico de salud. Sin tecnicismos complejos.",
                icon: Stethoscope,
                actions: [
                    { label: "Pedir un Turno", value: "Pedir un turno con el médico general para esta semana.", icon: Calendar },
                    { label: "Explicar un Síntoma", value: "Explicar de forma sencilla un dolor de garganta y fiebre.", icon: Thermometer },
                    { label: "Preguntar la Espera", value: "Preguntar cuánto falta para que le atiendan.", icon: Clock },
                    { label: "Rellenar la Ficha", value: "Pedir ayuda para completar sus datos en la ficha.", icon: FileText },
                    { label: "Pedir un Justificante", value: "Pedir un justificante de la consulta para el trabajo.", icon: CheckCircle },
                    { label: "Cambiar la Cita", value: "Pedir cambiar el turno a otro día porque no puede venir.", icon: ArrowRight }
                ]
            },
            {
                label: "Gimnasio",
                value: "Recepción de un gimnasio informando a un nuevo interesado",
                registerInstruction: "Registro cercano y comercial, cortés. Vocabulario de deporte cotidiano. Sin jerga técnica.",
                icon: Dumbbell,
                actions: [
                    { label: "Preguntar los Precios", value: "Preguntar cuánto cuesta la cuota mensual y qué incluye.", icon: DollarSign },
                    { label: "Horario de Clases", value: "Preguntar a qué hora son las clases de la semana.", icon: Clock },
                    { label: "Cómo Apuntarse", value: "Preguntar qué necesita para inscribirse hoy.", icon: UserPlus },
                    { label: "Usar una Máquina", value: "Pedir que le expliquen cómo usar una máquina.", icon: HelpCircle },
                    { label: "Traer un Amigo", value: "Preguntar si puede traer a un amigo de invitado.", icon: Users },
                    { label: "Congelar la Cuota", value: "Preguntar si puede pausar la cuota si se va de viaje.", icon: Ban }
                ]
            },
            {
                label: "Peluquería",
                value: "Un cliente y un peluquero en la peluquería",
                registerInstruction: "Registro cercano y cortés. Descripciones sencillas de lo que se quiere. Sin jerga técnica.",
                icon: Scissors,
                actions: [
                    { label: "Explicar el Corte", value: "Explicar cuánto quiere cortarse el pelo.", icon: Scissors },
                    { label: "Pedir un Turno", value: "Preguntar si le pueden atender ahora o pedir turno.", icon: Calendar },
                    { label: "Preguntar el Precio", value: "Preguntar cuánto cuesta cortar y lavar.", icon: DollarSign },
                    { label: "Charla Ligera", value: "Conversación breve y amable mientras cortan.", icon: MessageCircle },
                    { label: "No Muy Corto", value: "Pedir que no le corten demasiado y ajustar.", icon: Hand },
                    { label: "Peinar para un Evento", value: "Pedir un peinado sencillo para una fiesta.", icon: Sparkles }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Comisaría / Denuncia",
                value: "Un ciudadano hace un trámite ante un agente en una comisaría",
                registerInstruction: "Registro formal y preciso. Relato de hechos en pasado. Sin exabruptos; tono contenido.",
                icon: ShieldAlert,
                actions: [
                    { label: "Denunciar un Robo", value: "Relatar cómo le robaron la cartera y describir lo sucedido.", icon: AlertTriangle },
                    { label: "Objeto Perdido", value: "Reportar la pérdida de documentos y dar detalles.", icon: Search },
                    { label: "Queja por Ruido", value: "Denunciar ruidos molestos de un vecino de forma reiterada.", icon: Volume2 },
                    { label: "Testigo de un Hecho", value: "Declarar como testigo de un pequeño accidente de tránsito.", icon: Eye },
                    { label: "Reclamar una Multa", value: "Discutir una multa que considera injusta y pedir explicaciones.", icon: FileWarning },
                    { label: "Renovar un Documento", value: "Preguntar los pasos para renovar un documento oficial.", icon: FileText }
                ]
            },
            {
                label: "Soporte Técnico",
                value: "Llamada o mostrador de soporte técnico resolviendo un problema",
                registerInstruction: "Registro de servicio, cortés y paciente. Vocabulario técnico accesible. Manejo de frustración sin insultos.",
                icon: Laptop,
                actions: [
                    { label: "Sin Internet", value: "El internet no funciona y el técnico guía paso a paso para revisarlo.", icon: Wifi },
                    { label: "Olvidó la Contraseña", value: "Recuperar el acceso a una cuenta tras olvidar la contraseña.", icon: Lock },
                    { label: "Equipo Muy Lento", value: "Describir que el equipo va lento y buscar la causa.", icon: Server },
                    { label: "Cobro Inesperado", value: "Reclamar un cobro extra que no reconoce en el servicio.", icon: DollarSign },
                    { label: "Instalar un Programa", value: "Pedir ayuda para instalar y configurar un programa.", icon: Download },
                    { label: "Dar de Baja", value: "Pedir cancelar el servicio y negociar la retención.", icon: Ban }
                ]
            },
            {
                label: "Trabajo / Oficina",
                value: "Dos colegas o un empleado y su jefe conversando en la oficina",
                registerInstruction: "Registro profesional, semiformal. Diplomacia y justificaciones. Sin chismes ofensivos ni insultos.",
                icon: Briefcase,
                actions: [
                    { label: "Justificar un Retraso", value: "Explicar por qué entregó tarde un trabajo y proponer una solución.", icon: Clock },
                    { label: "Pedir un Aumento", value: "Plantear un aumento o días libres argumentando su desempeño.", icon: TrendingUp },
                    { label: "Explicar un Error", value: "Reconocer un error propio y ofrecer cómo corregirlo.", icon: AlertCircle },
                    { label: "Delegar una Tarea", value: "Pedir a un colega que asuma una tarea urgente.", icon: ListChecks },
                    { label: "Organizar una Reunión", value: "Acordar el día y la agenda de una reunión de equipo.", icon: Calendar },
                    { label: "Dar Feedback", value: "Dar una devolución honesta pero constructiva a un compañero.", icon: MessageCircle }
                ]
            },
            {
                label: "Inmobiliaria / Alquiler",
                value: "Un interesado y un agente inmobiliario tratando un alquiler",
                registerInstruction: "Registro comercial formal. Negociación cortés. Vocabulario de vivienda y contratos accesible.",
                icon: Home,
                actions: [
                    { label: "Buscar Alquiler", value: "Explicar qué tipo de vivienda busca y su presupuesto.", icon: Search },
                    { label: "Visitar el Inmueble", value: "Recorrer la vivienda y preguntar por su estado y gastos.", icon: DoorOpen },
                    { label: "Negociar el Contrato", value: "Discutir condiciones del contrato y la duración.", icon: FileText },
                    { label: "Reclamar el Depósito", value: "Pedir la devolución del depósito al terminar el alquiler.", icon: Coins },
                    { label: "Reportar una Avería", value: "Avisar de una avería en la vivienda y pedir arreglo.", icon: Wrench },
                    { label: "Problemas de Convivencia", value: "Plantear un conflicto con los vecinos y buscar solución.", icon: Users }
                ]
            },
            {
                label: "Taller Mecánico",
                value: "Un cliente y un mecánico en un taller de coches",
                registerInstruction: "Registro cercano y práctico. Descripción de problemas y presupuestos. Sin jerga excesiva.",
                icon: Wrench,
                actions: [
                    { label: "Describir un Ruido", value: "Explicar un ruido raro del coche que no sabe identificar.", icon: Volume2 },
                    { label: "Discutir el Presupuesto", value: "El arreglo es caro y el cliente pide alternativas.", icon: DollarSign },
                    { label: "Apurar el Arreglo", value: "Explicar que necesita el coche cuanto antes.", icon: Clock },
                    { label: "Revisión General", value: "Pedir una revisión completa antes de un viaje largo.", icon: ListChecks },
                    { label: "Batería o Rueda", value: "Resolver una batería descargada o una rueda pinchada.", icon: BatteryLow },
                    { label: "Segunda Opinión", value: "Dudar del diagnóstico y pedir que lo expliquen mejor.", icon: HelpCircle }
                ]
            },
            {
                label: "Entrevista de Trabajo",
                value: "Un candidato y un reclutador en una entrevista laboral",
                registerInstruction: "Registro formal y cuidado. Argumentación sobre uno mismo. Sin arrogancia ni excesiva informalidad.",
                icon: BriefcaseBusiness,
                actions: [
                    { label: "Hablar de tus Logros", value: "Contar una experiencia previa que demuestre sus capacidades.", icon: Trophy },
                    { label: "Tus Puntos Débiles", value: "Responder con tacto a la pregunta por sus defectos.", icon: Scale },
                    { label: "Negociar el Sueldo", value: "Plantear una expectativa salarial y justificarla.", icon: DollarSign },
                    { label: "Preguntar por el Puesto", value: "Hacer preguntas sobre el equipo y las tareas del puesto.", icon: HelpCircle },
                    { label: "Disponibilidad y Horario", value: "Aclarar horarios, modalidad y fecha de incorporación.", icon: Clock },
                    { label: "El Cierre", value: "Cerrar la entrevista y preguntar los próximos pasos.", icon: Handshake }
                ]
            },
            {
                label: "Banco / Finanzas",
                value: "Un cliente y un asesor en una sucursal bancaria",
                registerInstruction: "Registro formal y preciso. Vocabulario financiero accesible. Cortesía profesional.",
                icon: Landmark,
                actions: [
                    { label: "Abrir una Cuenta", value: "Preguntar requisitos y comisiones para abrir una cuenta.", icon: FileText },
                    { label: "Préstamo Rechazado", value: "Preguntar por qué le negaron un préstamo y qué opciones tiene.", icon: Ban },
                    { label: "Tarjeta Robada", value: "Reportar una tarjeta robada y bloquearla de urgencia.", icon: CreditCard },
                    { label: "Error en un Cargo", value: "Reclamar un cargo que no reconoce en la cuenta.", icon: AlertCircle },
                    { label: "Transferencia al Exterior", value: "Consultar cómo enviar dinero a otro país y su costo.", icon: Send },
                    { label: "Consultar Comisiones", value: "Preguntar por comisiones ocultas y cómo evitarlas.", icon: Percent }
                ]
            },
            {
                label: "Consulta Médica",
                value: "Un paciente y su médico en la consulta",
                registerInstruction: "Registro cortés y de confianza. Descripción de síntomas y dudas. Vocabulario de salud accesible.",
                icon: Stethoscope,
                actions: [
                    { label: "Describir un Dolor", value: "Explicar un dolor difícil de ubicar y cuándo aparece.", icon: Thermometer },
                    { label: "Pedir una Baja", value: "Pedir una baja laboral y explicar su situación.", icon: FileText },
                    { label: "Miedo al Tratamiento", value: "Expresar temor a un tratamiento y pedir alternativas.", icon: Frown },
                    { label: "Renovar una Receta", value: "Pedir renovar la receta de un medicamento habitual.", icon: Pill },
                    { label: "Hábitos y Dieta", value: "Conversar sobre cambios de dieta y hábitos saludables.", icon: Apple },
                    { label: "Derivar a un Especialista", value: "Pedir una derivación a un especialista y entender por qué.", icon: ArrowRight }
                ]
            },
            {
                label: "Veterinaria",
                value: "Un dueño de mascota y el veterinario en la clínica",
                registerInstruction: "Registro cercano y profesional. Preocupación por la mascota. Vocabulario accesible.",
                icon: Dog,
                actions: [
                    { label: "No Quiere Comer", value: "Explicar que la mascota no come y desde cuándo.", icon: Utensils },
                    { label: "Vacunas al Día", value: "Consultar el calendario de vacunas y ponerlas al día.", icon: Calendar },
                    { label: "Una Urgencia", value: "Llegar con una urgencia y describir qué pasó.", icon: Siren },
                    { label: "Factura Alta", value: "Sorprenderse por el costo y preguntar por opciones.", icon: DollarSign },
                    { label: "Cambio de Conducta", value: "Contar un cambio de comportamiento del animal.", icon: AlertCircle },
                    { label: "Cuidados en Casa", value: "Recibir indicaciones de cuidado y anotarlas.", icon: ListChecks }
                ]
            },
            {
                label: "Cena con Amigos",
                value: "Dos amigos conversando durante una cena informal",
                registerInstruction: "Registro coloquial entre iguales. Anécdotas y opiniones. Humor amable, sin ofensas reales.",
                icon: Utensils,
                actions: [
                    { label: "Dividir la Cuenta", value: "Ponerse de acuerdo para dividir la cuenta de forma justa.", icon: Receipt },
                    { label: "Contar una Anécdota", value: "Uno cuenta algo gracioso que le pasó esta semana.", icon: Smile },
                    { label: "Dar una Noticia", value: "Anunciar una novedad personal importante y reaccionar.", icon: Sparkles },
                    { label: "Organizar un Viaje", value: "Planear juntos un viaje: fechas, destino y presupuesto.", icon: Plane },
                    { label: "Pedir un Consejo", value: "Pedir consejo sobre un problema personal.", icon: HelpCircle },
                    { label: "Un Pequeño Desacuerdo", value: "Debatir con humor sobre gustos opuestos.", icon: MessageCircle }
                ]
            },
            {
                label: "Aeropuerto / Aerolínea",
                value: "Un pasajero y un agente de la aerolínea en el aeropuerto",
                registerInstruction: "Registro formal de servicio. Gestión de imprevistos con calma. Vocabulario de viajes.",
                icon: Plane,
                actions: [
                    { label: "Vuelo Cancelado", value: "El vuelo se canceló y busca reubicación y compensación.", icon: X },
                    { label: "Maleta Perdida", value: "Reportar que su maleta no llegó y dar los datos.", icon: Package },
                    { label: "Exceso de Equipaje", value: "Negociar el cobro por exceso de equipaje.", icon: Scale },
                    { label: "Cambiar el Asiento", value: "Pedir cambiar de asiento por un motivo concreto.", icon: UserPlus },
                    { label: "Conexión Ajustada", value: "Preocuparse por una conexión con poco tiempo.", icon: Clock },
                    { label: "Documentación", value: "Resolver una duda con la documentación de viaje.", icon: FileText }
                ]
            },
            {
                label: "Servicio al Cliente",
                value: "Un cliente y un agente de atención resolviendo un reclamo",
                registerInstruction: "Registro de servicio formal. Gestión de queja con firmeza cortés. Sin insultos.",
                icon: Headphones,
                actions: [
                    { label: "Producto Defectuoso", value: "Reclamar un producto que llegó dañado y pedir cambio.", icon: Package },
                    { label: "Pedir un Reembolso", value: "Solicitar la devolución del dinero y justificarlo.", icon: Coins },
                    { label: "Entrega que No Llega", value: "Reclamar por un pedido que no ha llegado a tiempo.", icon: Truck },
                    { label: "Cancelar una Suscripción", value: "Pedir cancelar una suscripción y evitar la retención.", icon: Ban },
                    { label: "Hablar con un Superior", value: "Pedir escalar el reclamo a un responsable.", icon: ArrowRight },
                    { label: "Confirmar la Solución", value: "Cerrar el reclamo confirmando plazos y compromisos.", icon: CheckCircle }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Redacción de Periódico",
                value: "Dos periodistas discuten en la redacción bajo presión de cierre",
                registerInstruction: "Registro profesional intenso. Jerga periodística, ironía y urgencia. Argumentación rápida.",
                icon: Newspaper,
                actions: [
                    { label: "Cambiar la Portada", value: "Debatir de urgencia si cambiar la portada por una noticia de última hora.", icon: AlertOctagon },
                    { label: "Proteger una Fuente", value: "Discutir si publicar con una fuente anónima y sus riesgos.", icon: Lock },
                    { label: "Corregir una Errata", value: "Tensa negociación sobre una errata ya impresa y su rectificación.", icon: FileWarning },
                    { label: "Dudar de una Noticia", value: "Sospechar que una información es falsa y decidir qué hacer.", icon: Eye },
                    { label: "Editar sin Piedad", value: "Recortar el artículo de un colega y justificar los cortes.", icon: Scissors },
                    { label: "El Cierre", value: "Resolver a contrarreloj los últimos detalles antes de cerrar.", icon: Clock }
                ]
            },
            {
                label: "Startup / Inversores",
                value: "Fundadores e inversores discuten el rumbo de una startup",
                registerInstruction: "Registro corporativo con anglicismos moderados. Persuasión y tensión. Optimismo estratégico.",
                icon: Rocket,
                actions: [
                    { label: "Pitch a Inversores", value: "Defender el proyecto ante un inversor escéptico.", icon: TrendingUp },
                    { label: "Negociar Participación", value: "Discutir el reparto accionario y el control de la empresa.", icon: PieChart },
                    { label: "Crisis Técnica", value: "Gestionar una caída de servidores mientras se lanza el producto.", icon: Server },
                    { label: "Un Despido Difícil", value: "Comunicar un despido con un discurso corporativo incómodo.", icon: X },
                    { label: "Cambiar de Estrategia", value: "Convencer al equipo de dar un giro al modelo de negocio.", icon: ArrowRight },
                    { label: "Agotamiento del Equipo", value: "Abordar el burnout de un fundador clave.", icon: BatteryLow }
                ]
            },
            {
                label: "Juicio / Legal",
                value: "Una sala de audiencias durante un interrogatorio o alegato",
                registerInstruction: "Registro jurídico formal. Retórica, objeciones y precisión. Tensión contenida.",
                icon: Gavel,
                actions: [
                    { label: "Interrogatorio Hostil", value: "Un abogado presiona a un testigo con preguntas incisivas.", icon: AlertTriangle },
                    { label: "Alegato Final", value: "Defender la inocencia con un alegato persuasivo.", icon: Megaphone },
                    { label: "Una Objeción", value: "Plantear una objeción técnica y discutirla con el juez.", icon: Ban },
                    { label: "Negociar un Acuerdo", value: "Negociar un acuerdo para evitar el juicio.", icon: Handshake },
                    { label: "Una Contradicción", value: "Exponer una mentira a partir de una contradicción del testigo.", icon: Eye },
                    { label: "Leer la Sentencia", value: "Escuchar y reaccionar a la lectura de la sentencia.", icon: FileText }
                ]
            },
            {
                label: "Galería de Arte",
                value: "Una inauguración de arte con conversaciones entre asistentes",
                registerInstruction: "Registro culto y pretencioso. Ironía fina, esnobismo y matices. Vocabulario artístico.",
                icon: Palette,
                actions: [
                    { label: "Crítica Pretenciosa", value: "Comentar una obra con jerga rebuscada y algo esnob.", icon: Eye },
                    { label: "Fingir que se Entiende", value: "Disimular que no entiende una obra abstracta.", icon: Ghost },
                    { label: "Comprar por Inversión", value: "Negociar la compra de una obra como inversión.", icon: DollarSign },
                    { label: "Debate Ético", value: "Discutir si una obra polémica debería exhibirse.", icon: Scale },
                    { label: "Un Accidente", value: "Manejar con tacto que alguien rozó una obra.", icon: AlertCircle },
                    { label: "Explicar 'el Vacío'", value: "El artista explica una obra minimalista con grandilocuencia.", icon: Sparkles }
                ]
            },
            {
                label: "Terapia Psicológica",
                value: "Una sesión entre terapeuta y paciente",
                registerInstruction: "Registro íntimo y contenido. Subtexto, pausas y matices emocionales. Sin dramatismo excesivo.",
                icon: Brain,
                actions: [
                    { label: "Una Confesión Difícil", value: "El paciente revela algo que le costaba decir.", icon: Lock },
                    { label: "Resistencia al Cambio", value: "El paciente se resiste a una interpretación del terapeuta.", icon: Ban },
                    { label: "Analizar un Sueño", value: "Explorar el significado de un sueño recurrente.", icon: Moon },
                    { label: "Un Silencio Incómodo", value: "Gestionar un silencio cargado en plena sesión.", icon: Volume2 },
                    { label: "Poner un Límite", value: "El terapeuta plantea el fin del proceso y sus razones.", icon: ArrowRight },
                    { label: "Un Avance", value: "El paciente reconoce por fin un patrón propio.", icon: Lightbulb }
                ]
            },
            {
                label: "Entrevista Política",
                value: "Un periodista entrevista en directo a una figura política",
                registerInstruction: "Registro público y estratégico. Evasivas, retórica y tensión. Cortesía tirante.",
                icon: Mic,
                actions: [
                    { label: "Evadir la Respuesta", value: "El político esquiva una pregunta incómoda con rodeos.", icon: Ghost },
                    { label: "El Ataque Personal", value: "La entrevista deriva en reproches personales controlados.", icon: Angry },
                    { label: "Discurso de Eslóganes", value: "Responder con frases hechas y desviar el tema.", icon: Megaphone },
                    { label: "Una Primicia", value: "El periodista busca arrancar una declaración inédita.", icon: Star },
                    { label: "Interrumpir a Tiempo", value: "Pugna por el turno de palabra y el control del tiempo.", icon: Clock },
                    { label: "Cifras en Disputa", value: "Discutir datos y cifras que ambos interpretan distinto.", icon: LineChart }
                ]
            },
            {
                label: "Cata de Vinos / Lujo",
                value: "Una cata de vinos entre personas entendidas",
                registerInstruction: "Registro sofisticado. Descripción sensorial rebuscada, esnobismo e ironía. Vocabulario especializado.",
                icon: Wine,
                actions: [
                    { label: "Descripción Sensorial", value: "Describir un vino con adjetivos casi imposibles.", icon: Sparkles },
                    { label: "Esnobismo Puro", value: "Presumir de conocimientos para impresionar.", icon: Eye },
                    { label: "El Vino Picado", value: "Detectar con tacto que una botella está en mal estado.", icon: AlertCircle },
                    { label: "El Maridaje", value: "Debatir el maridaje ideal con cierta pedantería.", icon: Utensils },
                    { label: "Un Brindis Hipócrita", value: "Brindar con palabras amables y doble sentido.", icon: Wine },
                    { label: "Precio y Valor", value: "Discutir si un vino carísimo vale realmente su precio.", icon: DollarSign }
                ]
            },
            {
                label: "Universidad / Tutoría",
                value: "Un profesor y un estudiante en una tutoría universitaria",
                registerInstruction: "Registro académico. Argumentación rigurosa y matices. Cortesía formal con tensión intelectual.",
                icon: GraduationCap,
                actions: [
                    { label: "Revisar un Examen", value: "El estudiante reclama la nota y argumenta su respuesta.", icon: FileText },
                    { label: "Sospecha de Plagio", value: "El profesor plantea con tacto una sospecha de plagio.", icon: AlertTriangle },
                    { label: "Debate Filosófico", value: "Discrepar sobre una teoría con argumentos sólidos.", icon: Brain },
                    { label: "Una Explicación Compleja", value: "Pedir que aclare un concepto difícil paso a paso.", icon: Lightbulb },
                    { label: "Una Beca en Juego", value: "Negociar una prórroga clave para conservar una beca.", icon: Coins },
                    { label: "Enfoque de la Tesis", value: "Debatir el rumbo y la viabilidad de un tema de tesis.", icon: BookOpen }
                ]
            },
            {
                label: "Rodaje de Cine",
                value: "Un set de rodaje con tensión entre director y actor",
                registerInstruction: "Registro creativo intenso. Ego, ironía y urgencia técnica. Jerga de rodaje moderada.",
                icon: Film,
                actions: [
                    { label: "Actor Caprichoso", value: "Un actor exige cambios de última hora en la escena.", icon: Star },
                    { label: "Director Enfadado", value: "El director pierde la paciencia tras varias tomas fallidas.", icon: Angry },
                    { label: "Un Fallo de Continuidad", value: "Detectar un error de raccord y decidir cómo resolverlo.", icon: Eye },
                    { label: "Una Escena Difícil", value: "Preparar una escena emocional que no sale.", icon: Drama },
                    { label: "Problemas de Presupuesto", value: "Recortar una secuencia costosa y convencer al equipo.", icon: DollarSign },
                    { label: "El Clima No Ayuda", value: "Improvisar por un cambio de clima que arruina el plan.", icon: Cloud }
                ]
            },
            {
                label: "Comunidad de Vecinos",
                value: "Una reunión tensa entre vecinos de un edificio",
                registerInstruction: "Registro coloquial pero acalorado. Reproches, negociación y sarcasmo. Sin insultos graves.",
                icon: Building,
                actions: [
                    { label: "Un Gasto Extra", value: "Debatir una derrama para una reparación costosa.", icon: Coins },
                    { label: "Ruidos Nocturnos", value: "Encarar a un vecino por ruidos molestos de madrugada.", icon: Volume2 },
                    { label: "El Presidente Pesado", value: "Cuestionar decisiones autoritarias del presidente.", icon: Gavel },
                    { label: "Obras sin Permiso", value: "Denunciar obras irregulares de un vecino.", icon: Hammer },
                    { label: "Vecinos Morosos", value: "Discutir qué hacer con quienes no pagan la cuota.", icon: Ban },
                    { label: "El Uso del Portal", value: "Discutir el uso de espacios comunes y las llaves.", icon: DoorOpen }
                ]
            },
            {
                label: "Negociación / Diplomacia",
                value: "Dos representantes negocian un acuerdo delicado",
                registerInstruction: "Registro diplomático formal. Protocolo, matices y dobles sentidos. Tensión contenida.",
                icon: Globe,
                actions: [
                    { label: "Un Malentendido", value: "Una traducción ambigua amenaza con romper la negociación.", icon: MessageCircle },
                    { label: "El Ultimátum", value: "Una parte plantea una condición innegociable.", icon: AlertOctagon },
                    { label: "Romper el Protocolo", value: "Un gesto fuera de protocolo genera tensión.", icon: Flag },
                    { label: "Buscar un Punto Medio", value: "Explorar concesiones mutuas para un acuerdo.", icon: Handshake },
                    { label: "La Firma", value: "Ultimar los términos justo antes de firmar.", icon: FileText },
                    { label: "Ganar Tiempo", value: "Una parte dilata la decisión con evasivas corteses.", icon: Clock }
                ]
            },
            {
                label: "Backstage / Música",
                value: "Entre bambalinas de un concierto, minutos antes de salir",
                registerInstruction: "Registro informal de gremio artístico. Nervios, jerga y urgencia. Humor y tensión.",
                icon: Guitar,
                actions: [
                    { label: "Exigencias del Camerino", value: "Discutir las condiciones del camerino con producción.", icon: ListChecks },
                    { label: "Fallo de Sonido", value: "Resolver un problema técnico de sonido antes de salir.", icon: Volume2 },
                    { label: "Nervios Antes de Salir", value: "Calmar el pánico escénico de un compañero.", icon: Frown },
                    { label: "Cambiar el Repertorio", value: "Decidir a último momento un cambio en la lista de temas.", icon: Music },
                    { label: "Una Entrevista Exprés", value: "Dar una entrevista rápida y esquivar preguntas incómodas.", icon: Mic },
                    { label: "Alguien se Coló", value: "Manejar con firmeza a alguien que entró sin permiso.", icon: DoorOpen }
                ]
            }
        ]
    },
    [TextType.RadioNews]: {
        [Level.Intro]: [
            {
                label: "El Tiempo",
                value: "Boletín meteorológico breve leído por un locutor",
                registerInstruction: "Registro informativo claro y neutro. Datos concretos (grados, horas, porcentajes). Ritmo natural, sin simplificar.",
                icon: Sun,
                actions: [
                    { label: "La Temperatura", value: "Dar la temperatura máxima y mínima del día en grados.", icon: Thermometer },
                    { label: "Aviso de Lluvia", value: "Anunciar la probabilidad de lluvia y a qué hora.", icon: Droplet },
                    { label: "El Pronóstico", value: "Adelantar la temperatura y la hora del cambio de tiempo para mañana.", icon: Cloud },
                    { label: "Hora del Reporte", value: "Indicar la hora exacta del boletín meteorológico.", icon: Clock }
                ]
            },
            {
                label: "Tráfico",
                value: "Reporte de tráfico urbano leído en la radio",
                registerInstruction: "Registro informativo funcional. Calles, tiempos y números claros. Ritmo ágil.",
                icon: Car,
                actions: [
                    { label: "Un Atasco", value: "Informar de un atasco en una avenida y los minutos de demora.", icon: AlertTriangle },
                    { label: "Calle Cerrada", value: "Anunciar el corte de una calle y desde qué hora.", icon: Ban },
                    { label: "Ruta Alternativa", value: "Recomendar una ruta alternativa y cuántos minutos se ahorran.", icon: Navigation },
                    { label: "Tiempo Estimado", value: "Decir cuántos minutos extra hay que sumar por las demoras.", icon: Clock }
                ]
            },
            {
                label: "Servicios de la Ciudad",
                value: "Avisos de servicios municipales en la radio local",
                registerInstruction: "Registro institucional claro. Horarios, teléfonos y fechas concretos. Tono neutro.",
                icon: Recycle,
                actions: [
                    { label: "Corte de Agua", value: "Anunciar un corte de agua con horario de inicio y fin.", icon: Droplet },
                    { label: "Recolección de Basura", value: "Informar los días y la hora de recolección.", icon: Trash2 },
                    { label: "Teléfono de Información", value: "Dictar un número de teléfono de atención al ciudadano.", icon: Phone },
                    { label: "Horario de la Biblioteca", value: "Dar el nuevo horario de apertura de la biblioteca.", icon: Clock }
                ]
            },
            {
                label: "Agenda Cultural",
                value: "Cartelera cultural leída en la radio",
                registerInstruction: "Registro ameno e informativo. Horas, lugares y precios concretos. Ritmo natural.",
                icon: Ticket,
                actions: [
                    { label: "Un Concierto", value: "Anunciar un concierto con hora y lugar exactos.", icon: Music },
                    { label: "Museo Gratis", value: "Informar el día y horario de entrada gratuita al museo.", icon: Landmark },
                    { label: "Precio de la Entrada", value: "Dar el precio de las entradas de un evento.", icon: DollarSign },
                    { label: "Dónde y Cuándo", value: "Repetir la dirección y la hora del evento.", icon: MapPin }
                ]
            },
            {
                label: "Transporte Público",
                value: "Avisos sobre el transporte público en la radio",
                registerInstruction: "Registro informativo funcional. Líneas, horarios y tarifas claros. Tono neutro.",
                icon: Bus,
                actions: [
                    { label: "Cambio de Recorrido", value: "Anunciar el desvío de una línea de autobús indicando su número y las paradas afectadas.", icon: Navigation },
                    { label: "Nuevo Horario", value: "Informar el nuevo horario del primer y último servicio.", icon: Clock },
                    { label: "Precio del Billete", value: "Anunciar la nueva tarifa del billete.", icon: DollarSign },
                    { label: "Número de Línea", value: "Indicar qué número de línea llega a la estación.", icon: Hash }
                ]
            },
            {
                label: "Avisos de la Escuela",
                value: "Comunicados de una escuela leídos en la radio",
                registerInstruction: "Registro institucional cercano. Fechas y horas concretas. Claridad ante todo.",
                icon: School,
                actions: [
                    { label: "Fecha de un Examen", value: "Anunciar la fecha exacta de un examen importante.", icon: Calendar },
                    { label: "Evento Deportivo", value: "Informar la hora y el lugar de un partido escolar.", icon: Trophy },
                    { label: "Cambio de Horario", value: "Avisar de un cambio en el horario de entrada.", icon: Clock },
                    { label: "Reunión de Padres", value: "Dar el día y la hora de la reunión de familias.", icon: Users }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Noticias del Barrio",
                value: "Boletín de noticias locales de un barrio",
                registerInstruction: "Registro informativo sencillo. Frases claras, vocabulario frecuente. Ritmo natural.",
                icon: Home,
                actions: [
                    { label: "Una Fiesta del Barrio", value: "Anunciar las fiestas del barrio y sus actividades.", icon: Gift },
                    { label: "Una Obra en la Calle", value: "Informar de obras que afectan a una calle.", icon: Hammer },
                    { label: "Un Nuevo Comercio", value: "Contar que abrió un nuevo comercio en la zona.", icon: ShoppingBag },
                    { label: "Campaña de Limpieza", value: "Invitar a una jornada de limpieza vecinal.", icon: Recycle },
                    { label: "Un Reconocimiento", value: "Homenajear a un vecino por su labor solidaria.", icon: Star },
                    { label: "Un Aviso Útil", value: "Recordar un trámite municipal a los vecinos.", icon: Bell }
                ]
            },
            {
                label: "Deportes Locales",
                value: "Resumen deportivo de equipos y eventos locales",
                registerInstruction: "Registro ameno y claro. Resultados y datos sencillos. Entusiasmo moderado.",
                icon: Trophy,
                actions: [
                    { label: "El Partido del Fin de Semana", value: "Contar el resultado del partido local.", icon: Trophy },
                    { label: "Un Torneo Escolar", value: "Anunciar un torneo entre escuelas del barrio.", icon: School },
                    { label: "Una Carrera Popular", value: "Invitar a una carrera solidaria y dar detalles.", icon: TrendingUp },
                    { label: "Un Nuevo Fichaje", value: "Presentar a un jugador que llega al equipo.", icon: UserPlus },
                    { label: "Clases de Deporte", value: "Anunciar clases gratuitas de deporte para jóvenes.", icon: Dumbbell },
                    { label: "El Calendario", value: "Recordar las fechas de los próximos partidos.", icon: Calendar }
                ]
            },
            {
                label: "Clima y Estaciones",
                value: "Boletín ampliado del tiempo y el cambio de estación",
                registerInstruction: "Registro informativo claro. Descripciones sencillas del clima. Consejos prácticos.",
                icon: Cloud,
                actions: [
                    { label: "Llega el Frío", value: "Anunciar una bajada de temperaturas y dar consejos.", icon: Thermometer },
                    { label: "Una Ola de Calor", value: "Alertar de días muy calurosos y recomendar cuidados.", icon: Sun },
                    { label: "Viento Fuerte", value: "Avisar de rachas de viento en la región.", icon: Wind },
                    { label: "Lluvias de la Semana", value: "Adelantar los días de lluvia previstos.", icon: Droplet },
                    { label: "Consejo de Ropa", value: "Recomendar cómo abrigarse según el pronóstico.", icon: Shirt },
                    { label: "El Fin de Semana", value: "Resumir el tiempo esperado para el fin de semana.", icon: Calendar }
                ]
            },
            {
                label: "Salud y Bienestar",
                value: "Sección de salud con consejos sencillos",
                registerInstruction: "Registro divulgativo y cercano. Consejos claros, sin tecnicismos. Tono positivo.",
                icon: Stethoscope,
                actions: [
                    { label: "Beber Más Agua", value: "Recomendar hidratarse bien durante el día.", icon: Droplet },
                    { label: "Campaña de Vacunación", value: "Informar dónde y cuándo vacunarse.", icon: Pill },
                    { label: "Dormir Mejor", value: "Dar consejos sencillos para descansar bien.", icon: Moon },
                    { label: "Moverse Cada Día", value: "Animar a caminar y hacer ejercicio suave.", icon: Dumbbell },
                    { label: "Comer Fruta", value: "Recomendar incluir más fruta y verdura.", icon: Apple },
                    { label: "Cuidar la Vista", value: "Dar un consejo para descansar la vista de las pantallas.", icon: Eye }
                ]
            },
            {
                label: "Cultura y Ocio",
                value: "Agenda de cultura y tiempo libre para la semana",
                registerInstruction: "Registro ameno e informativo. Vocabulario cotidiano de ocio. Ritmo natural.",
                icon: Music,
                actions: [
                    { label: "Estreno de Cine", value: "Anunciar el estreno de una película popular.", icon: Film },
                    { label: "Feria del Libro", value: "Invitar a una feria del libro y sus actividades.", icon: BookOpen },
                    { label: "Concierto al Aire Libre", value: "Contar un concierto gratuito en el parque.", icon: Guitar },
                    { label: "Taller para Niños", value: "Anunciar un taller creativo para los más pequeños.", icon: Baby },
                    { label: "Exposición Nueva", value: "Presentar una exposición que abre esta semana.", icon: Palette },
                    { label: "Recomendación Musical", value: "Recomendar un disco o artista de la semana.", icon: Headphones }
                ]
            },
            {
                label: "Transporte y Movilidad",
                value: "Novedades del transporte y la movilidad de la ciudad",
                registerInstruction: "Registro informativo funcional. Datos claros de líneas y horarios. Tono neutro.",
                icon: Bus,
                actions: [
                    { label: "Nueva Línea de Bus", value: "Anunciar una línea de autobús que empieza a funcionar.", icon: Bus },
                    { label: "Carril para Bicis", value: "Contar la apertura de un nuevo carril bici.", icon: Navigation },
                    { label: "Cambios en el Metro", value: "Informar de obras y cambios en el metro.", icon: Train },
                    { label: "Alquiler de Bicis", value: "Explicar un nuevo servicio de bicis compartidas.", icon: Recycle },
                    { label: "Consejo para el Tráfico", value: "Recomendar horarios para evitar los atascos.", icon: Clock },
                    { label: "Aparcamiento", value: "Informar de cambios en las zonas de aparcamiento.", icon: Car }
                ]
            },
            {
                label: "Consumo y Ahorro",
                value: "Consejos prácticos de consumo y ahorro para el hogar",
                registerInstruction: "Registro cercano y útil. Vocabulario cotidiano de dinero. Tono práctico.",
                icon: PiggyBank,
                actions: [
                    { label: "Ahorrar en Casa", value: "Dar consejos sencillos para gastar menos en el hogar.", icon: Home },
                    { label: "Ofertas de la Semana", value: "Informar de ofertas en productos básicos.", icon: Percent },
                    { label: "Cuidado con las Estafas", value: "Alertar de una estafa común y cómo evitarla.", icon: ShieldAlert },
                    { label: "Comparar Precios", value: "Recomendar comparar antes de comprar algo caro.", icon: Scale },
                    { label: "Ahorrar Energía", value: "Dar consejos para reducir la factura de la luz.", icon: Zap },
                    { label: "Reciclar y Reusar", value: "Animar a reutilizar para ahorrar y cuidar el planeta.", icon: Recycle }
                ]
            },
            {
                label: "Ferias y Mercados",
                value: "Anuncios de ferias, mercados y eventos comerciales",
                registerInstruction: "Registro ameno e informativo. Horarios y lugares claros. Entusiasmo moderado.",
                icon: ShoppingBag,
                actions: [
                    { label: "Mercado de Productores", value: "Invitar a un mercado de productos locales.", icon: Apple },
                    { label: "Feria de Artesanía", value: "Anunciar una feria de artesanos y sus puestos.", icon: Gift },
                    { label: "Mercadillo de Segunda Mano", value: "Contar un mercadillo de ropa y objetos usados.", icon: Shirt },
                    { label: "Feria Gastronómica", value: "Presentar una feria de comida típica.", icon: Utensils },
                    { label: "Horario y Lugar", value: "Repetir los horarios y la ubicación de la feria.", icon: MapPin },
                    { label: "Cómo Participar", value: "Explicar cómo poner un puesto en la feria.", icon: UserPlus }
                ]
            },
            {
                label: "Medio Ambiente Local",
                value: "Noticias ambientales de la comunidad",
                registerInstruction: "Registro divulgativo y positivo. Vocabulario ambiental sencillo. Llamado a la acción suave.",
                icon: Leaf,
                actions: [
                    { label: "Plantar Árboles", value: "Invitar a una jornada de plantación de árboles.", icon: TreePine },
                    { label: "Limpieza del Río", value: "Anunciar una limpieza de la ribera del río.", icon: Waves },
                    { label: "Reciclar Bien", value: "Explicar cómo separar la basura correctamente.", icon: Recycle },
                    { label: "Menos Plástico", value: "Animar a reducir el uso de plástico de un solo uso.", icon: Ban },
                    { label: "Un Parque Nuevo", value: "Contar la apertura de un nuevo parque verde.", icon: Sprout },
                    { label: "Cuidar los Animales", value: "Recordar cómo proteger a la fauna urbana.", icon: Dog }
                ]
            },
            {
                label: "Turismo de la Región",
                value: "Recomendaciones turísticas de la zona",
                registerInstruction: "Registro ameno y descriptivo. Vocabulario de viaje sencillo. Tono invitador.",
                icon: MapPin,
                actions: [
                    { label: "Un Pueblo con Encanto", value: "Recomendar visitar un pueblo cercano.", icon: Home },
                    { label: "Una Ruta de Senderismo", value: "Describir una ruta fácil para caminar.", icon: TreePine },
                    { label: "Playa o Montaña", value: "Comparar un plan de playa y uno de montaña.", icon: Sun },
                    { label: "Comida Típica", value: "Recomendar dónde probar la comida local.", icon: Utensils },
                    { label: "Cómo Llegar", value: "Explicar cómo llegar en transporte público.", icon: Bus },
                    { label: "Precio y Horarios", value: "Dar precios de entrada y horarios de visita.", icon: Clock }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Política Municipal",
                value: "Noticias sobre decisiones del gobierno de la ciudad",
                registerInstruction: "Registro informativo formal. Vocabulario cívico y administrativo. Objetividad y matices.",
                icon: Landmark,
                actions: [
                    { label: "Nuevo Presupuesto", value: "Informar sobre el presupuesto municipal y sus prioridades.", icon: PieChart },
                    { label: "Debate en el Pleno", value: "Resumir un debate acalorado en el ayuntamiento.", icon: Megaphone },
                    { label: "Una Obra Polémica", value: "Contar una obra pública que divide a los vecinos.", icon: Hammer },
                    { label: "Consulta Ciudadana", value: "Anunciar una consulta a los vecinos sobre un plan.", icon: Vote },
                    { label: "Impuestos Locales", value: "Explicar un cambio en las tasas municipales.", icon: Coins },
                    { label: "Promesas y Plazos", value: "Contrastar promesas anteriores con los plazos reales.", icon: Clock }
                ]
            },
            {
                label: "Economía Nacional",
                value: "Panorama económico del país explicado para el público",
                registerInstruction: "Registro divulgativo formal. Datos económicos explicados con claridad. Cautela interpretativa.",
                icon: LineChart,
                actions: [
                    { label: "Sube el Costo de Vida", value: "Explicar cómo suben los precios y a quién afecta.", icon: TrendingUp },
                    { label: "Empleo y Desempleo", value: "Informar las cifras de empleo del trimestre.", icon: Briefcase },
                    { label: "El Precio de la Energía", value: "Analizar la variación en el precio de la energía.", icon: Zap },
                    { label: "Ayudas del Estado", value: "Explicar una nueva ayuda económica y quién puede pedirla.", icon: HandCoins },
                    { label: "Consumo de las Familias", value: "Comentar cómo cambia el gasto de los hogares.", icon: ShoppingBag },
                    { label: "Perspectivas del Año", value: "Adelantar las previsiones económicas para el año.", icon: Calendar }
                ]
            },
            {
                label: "Tecnología y Sociedad",
                value: "Noticias sobre tecnología y su impacto cotidiano",
                registerInstruction: "Registro divulgativo. Vocabulario técnico accesible. Mirada crítica moderada.",
                icon: Laptop,
                actions: [
                    { label: "Nueva App Útil", value: "Presentar una aplicación que facilita un trámite.", icon: Download },
                    { label: "Privacidad de los Datos", value: "Alertar sobre el uso de los datos personales.", icon: Lock },
                    { label: "Inteligencia Artificial", value: "Explicar un uso cotidiano de la inteligencia artificial.", icon: Brain },
                    { label: "Brecha Digital", value: "Comentar quiénes quedan fuera de la tecnología.", icon: Users },
                    { label: "Estafas en Línea", value: "Informar de un fraude digital frecuente.", icon: ShieldAlert },
                    { label: "Trabajo a Distancia", value: "Analizar cómo cambió el teletrabajo la vida laboral.", icon: Home }
                ]
            },
            {
                label: "Ciencia y Salud",
                value: "Divulgación de avances científicos y de salud",
                registerInstruction: "Registro divulgativo riguroso. Explicar términos con claridad. Prudencia ante los datos.",
                icon: FlaskConical,
                actions: [
                    { label: "Un Estudio Nuevo", value: "Resumir los resultados de un estudio reciente.", icon: FileText },
                    { label: "Prevenir una Enfermedad", value: "Explicar cómo prevenir una enfermedad común.", icon: Stethoscope },
                    { label: "Alimentación y Salud", value: "Comentar hallazgos sobre dieta y bienestar.", icon: Apple },
                    { label: "Salud Mental", value: "Informar sobre la importancia del bienestar emocional.", icon: Brain },
                    { label: "Un Avance Médico", value: "Contar un avance que mejora un tratamiento.", icon: Pill },
                    { label: "Mitos y Verdades", value: "Desmentir un mito de salud muy extendido.", icon: HelpCircle }
                ]
            },
            {
                label: "Medio Ambiente",
                value: "Noticias ambientales de alcance regional y nacional",
                registerInstruction: "Registro informativo comprometido pero objetivo. Vocabulario ambiental. Datos claros.",
                icon: TreePine,
                actions: [
                    { label: "Cambio Climático", value: "Explicar un efecto local del cambio climático.", icon: Thermometer },
                    { label: "Energías Renovables", value: "Informar sobre un proyecto de energía limpia.", icon: Sun },
                    { label: "Gestión del Agua", value: "Comentar medidas para ahorrar agua en sequía.", icon: Droplet },
                    { label: "Proteger un Bosque", value: "Contar un plan para conservar un área natural.", icon: TreePine },
                    { label: "Contaminación del Aire", value: "Informar sobre la calidad del aire en la ciudad.", icon: Wind },
                    { label: "Reciclaje Industrial", value: "Explicar cómo una empresa reduce sus residuos.", icon: Recycle }
                ]
            },
            {
                label: "Tribunales y Justicia",
                value: "Noticias sobre casos judiciales y justicia",
                registerInstruction: "Registro formal y prudente. Presunción de inocencia y precisión. Sin sensacionalismo.",
                icon: Gavel,
                actions: [
                    { label: "Un Juicio Importante", value: "Resumir el inicio de un juicio de interés público.", icon: Gavel },
                    { label: "Una Sentencia", value: "Informar el fallo de un caso y sus consecuencias.", icon: FileText },
                    { label: "Derechos del Consumidor", value: "Explicar una resolución que protege a los usuarios.", icon: ShieldAlert },
                    { label: "Un Caso de Corrupción", value: "Contar los avances de una investigación por corrupción.", icon: Eye },
                    { label: "Nueva Ley", value: "Explicar cómo afecta una ley a la vida diaria.", icon: BookOpen },
                    { label: "Mediación y Acuerdos", value: "Informar de un acuerdo que evita un juicio largo.", icon: Handshake }
                ]
            },
            {
                label: "Educación",
                value: "Noticias del ámbito educativo",
                registerInstruction: "Registro informativo formal. Vocabulario educativo. Equilibrio entre datos y contexto.",
                icon: GraduationCap,
                actions: [
                    { label: "Inicio de Clases", value: "Informar sobre el arranque del curso escolar.", icon: School },
                    { label: "Becas Disponibles", value: "Explicar nuevas becas y cómo solicitarlas.", icon: Coins },
                    { label: "Reforma Educativa", value: "Resumir un cambio en el plan de estudios.", icon: BookOpen },
                    { label: "Tecnología en el Aula", value: "Contar cómo se usan las pantallas en la escuela.", icon: Laptop },
                    { label: "Formación para Adultos", value: "Anunciar cursos de formación para mayores.", icon: Users },
                    { label: "Resultados y Desafíos", value: "Comentar resultados educativos y sus retos.", icon: LineChart }
                ]
            },
            {
                label: "Infraestructura Urbana",
                value: "Noticias sobre obras e infraestructura de la ciudad",
                registerInstruction: "Registro informativo técnico-accesible. Datos de plazos y costos. Objetividad.",
                icon: Building2,
                actions: [
                    { label: "Un Puente Nuevo", value: "Informar sobre la construcción de un puente y sus plazos.", icon: Building2 },
                    { label: "Reforma de una Avenida", value: "Contar una gran obra vial y sus molestias temporales.", icon: Hammer },
                    { label: "Ampliar el Metro", value: "Anunciar la ampliación de la red de metro.", icon: Train },
                    { label: "Red de Agua", value: "Explicar una mejora en el suministro de agua.", icon: Droplet },
                    { label: "Espacios Verdes", value: "Informar sobre nuevos parques y plazas.", icon: TreePine },
                    { label: "Costos y Retrasos", value: "Comentar sobrecostos y retrasos en una obra.", icon: DollarSign }
                ]
            },
            {
                label: "Seguridad Vial",
                value: "Campañas y noticias sobre seguridad en las carreteras",
                registerInstruction: "Registro informativo con tono de prevención. Datos y consejos claros. Seriedad.",
                icon: Car,
                actions: [
                    { label: "Campaña de Velocidad", value: "Informar de controles de velocidad y sus razones.", icon: Watch },
                    { label: "Cinturón y Casco", value: "Recordar la importancia de las medidas de seguridad.", icon: ShieldAlert },
                    { label: "Accidentes del Fin de Semana", value: "Resumir las cifras de siniestros y sus causas.", icon: AlertTriangle },
                    { label: "Nuevas Normas", value: "Explicar un cambio en las normas de tránsito.", icon: BookOpen },
                    { label: "Peatones y Ciclistas", value: "Dar consejos para proteger a peatones y ciclistas.", icon: Navigation },
                    { label: "Conducir con Lluvia", value: "Recomendar precauciones al conducir con mal tiempo.", icon: Droplet }
                ]
            },
            {
                label: "Cultura y Espectáculos",
                value: "Actualidad cultural y del mundo del espectáculo",
                registerInstruction: "Registro ameno pero informado. Vocabulario cultural. Opinión moderada.",
                icon: Drama,
                actions: [
                    { label: "Un Festival", value: "Presentar un festival cultural y su programa.", icon: Ticket },
                    { label: "Un Premio Importante", value: "Informar sobre un premio y su ganador.", icon: Trophy },
                    { label: "Estreno de Teatro", value: "Reseñar el estreno de una obra de teatro.", icon: Drama },
                    { label: "Patrimonio en Riesgo", value: "Contar el estado de un monumento que necesita ayuda.", icon: Landmark },
                    { label: "Nueva Serie o Película", value: "Comentar el éxito de una producción reciente.", icon: Tv },
                    { label: "Artistas Emergentes", value: "Presentar a un artista joven que despunta.", icon: Star }
                ]
            },
            {
                label: "Trabajo y Empleo",
                value: "Noticias sobre el mercado laboral",
                registerInstruction: "Registro informativo formal. Vocabulario laboral. Datos con contexto.",
                icon: Briefcase,
                actions: [
                    { label: "Ofertas de Empleo", value: "Informar sobre sectores que buscan trabajadores.", icon: Search },
                    { label: "Derechos Laborales", value: "Explicar un derecho laboral poco conocido.", icon: ShieldAlert },
                    { label: "Formación y Empleo", value: "Relacionar cursos con salidas laborales.", icon: GraduationCap },
                    { label: "Salario Mínimo", value: "Comentar un cambio en el salario mínimo.", icon: Coins },
                    { label: "Trabajo Joven", value: "Analizar la situación laboral de los jóvenes.", icon: Users },
                    { label: "Nuevas Profesiones", value: "Presentar oficios que surgen con la tecnología.", icon: Rocket }
                ]
            },
            {
                label: "Sucesos y Comunidad",
                value: "Sucesos locales e iniciativas comunitarias",
                registerInstruction: "Registro informativo prudente. Equilibrio entre suceso y solidaridad. Sin morbo.",
                icon: Siren,
                actions: [
                    { label: "Un Rescate", value: "Contar un rescate exitoso de los servicios de emergencia.", icon: FireExtinguisher },
                    { label: "Solidaridad Vecinal", value: "Relatar cómo un barrio ayudó a una familia.", icon: HeartHandshake },
                    { label: "Prevención de Incendios", value: "Dar consejos para prevenir incendios en verano.", icon: FireExtinguisher },
                    { label: "Un Animal Perdido", value: "Difundir la búsqueda de una mascota perdida.", icon: Dog },
                    { label: "Objetos Encontrados", value: "Informar sobre pertenencias halladas y cómo recuperarlas.", icon: Search },
                    { label: "Voluntariado", value: "Invitar a sumarse a una iniciativa de voluntariado.", icon: Users }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Última Hora",
                value: "Cobertura en vivo de una noticia de última hora",
                registerInstruction: "Registro periodístico de urgencia. Densidad informativa, matices y cautela. Ritmo alto.",
                icon: Siren,
                actions: [
                    { label: "Los Primeros Datos", value: "Comunicar los primeros datos confirmados con prudencia.", icon: AlertOctagon },
                    { label: "Fuentes en Contraste", value: "Contrastar versiones distintas de un mismo hecho.", icon: Eye },
                    { label: "Reacciones Oficiales", value: "Recoger las primeras reacciones de las autoridades.", icon: Megaphone },
                    { label: "El Contexto", value: "Situar la noticia en su contexto más amplio.", icon: Globe },
                    { label: "Lo que No se Sabe", value: "Delimitar con rigor lo confirmado y lo incierto.", icon: HelpCircle },
                    { label: "Próximas Horas", value: "Anticipar los desarrollos previstos con cautela.", icon: Clock }
                ]
            },
            {
                label: "Cobertura de Crisis",
                value: "Seguimiento informativo de una crisis en desarrollo",
                registerInstruction: "Registro sobrio y riguroso. Terminología especializada, ponderación. Evitar alarmismo.",
                icon: AlertOctagon,
                actions: [
                    { label: "Dimensión del Problema", value: "Cuantificar el alcance de la crisis con datos.", icon: LineChart },
                    { label: "Respuesta Institucional", value: "Analizar la gestión de las instituciones.", icon: Landmark },
                    { label: "Voces Expertas", value: "Integrar el análisis de especialistas.", icon: Brain },
                    { label: "Impacto en la Gente", value: "Mostrar cómo afecta a la población concreta.", icon: Users },
                    { label: "Errores y Aciertos", value: "Evaluar con equilibrio los aciertos y fallos.", icon: Scale },
                    { label: "Escenarios Posibles", value: "Plantear escenarios futuros con condicionales.", icon: ArrowRight }
                ]
            },
            {
                label: "Investigación Periodística",
                value: "Reportaje de investigación con hallazgos propios",
                registerInstruction: "Registro narrativo-informativo cuidado. Rigor, documentación y matiz. Tono contenido.",
                icon: Search,
                actions: [
                    { label: "El Hallazgo", value: "Presentar el hallazgo central de la investigación.", icon: Lightbulb },
                    { label: "Seguir el Dinero", value: "Rastrear un circuito financiero opaco.", icon: Coins },
                    { label: "Documentos Filtrados", value: "Explicar el valor y los límites de unos documentos.", icon: FileText },
                    { label: "Proteger a las Fuentes", value: "Justificar el anonimato de las fuentes.", icon: Lock },
                    { label: "El Desmentido", value: "Contrastar la versión oficial con las pruebas.", icon: Ban },
                    { label: "Consecuencias", value: "Analizar el impacto del reportaje.", icon: Zap }
                ]
            },
            {
                label: "Editorial de Opinión",
                value: "Columna editorial con una tesis argumentada",
                registerInstruction: "Registro argumentativo culto. Tesis clara, ironía y retórica. Cohesión elaborada.",
                icon: Newspaper,
                actions: [
                    { label: "Plantear la Tesis", value: "Enunciar una posición y anticipar la argumentación.", icon: Flag },
                    { label: "El Contraargumento", value: "Reconocer y refutar la objeción principal.", icon: Scale },
                    { label: "Una Analogía", value: "Usar una analogía para iluminar el problema.", icon: Lightbulb },
                    { label: "La Ironía", value: "Emplear ironía para criticar una postura.", icon: Drama },
                    { label: "Datos al Servicio de la Idea", value: "Integrar datos para sostener la tesis.", icon: LineChart },
                    { label: "El Cierre Contundente", value: "Rematar con una conclusión memorable.", icon: Megaphone }
                ]
            },
            {
                label: "Economía y Mercados",
                value: "Análisis económico de mercados y tendencias",
                registerInstruction: "Registro técnico-divulgativo. Jerga económica explicada, prudencia analítica. Precisión.",
                icon: TrendingUp,
                actions: [
                    { label: "Las Bolsas", value: "Interpretar el movimiento de los mercados y sus causas.", icon: LineChart },
                    { label: "Inflación y Tipos", value: "Explicar la relación entre inflación y tasas de interés.", icon: Percent },
                    { label: "Riesgo y Confianza", value: "Analizar la confianza de los inversores.", icon: Scale },
                    { label: "Materias Primas", value: "Comentar el precio de una materia prima clave.", icon: Fuel },
                    { label: "Comercio Global", value: "Analizar tensiones en el comercio internacional.", icon: Ship },
                    { label: "Lectura de Fondo", value: "Distinguir el ruido del dato de la tendencia real.", icon: Eye }
                ]
            },
            {
                label: "Geopolítica",
                value: "Análisis de relaciones internacionales y conflictos",
                registerInstruction: "Registro analítico formal. Terminología diplomática, equilibrio y matiz. Sin partidismo.",
                icon: Globe,
                actions: [
                    { label: "Un Conflicto Regional", value: "Explicar las raíces de un conflicto y sus actores.", icon: Flag },
                    { label: "Alianzas y Tensiones", value: "Analizar el juego de alianzas entre potencias.", icon: Handshake },
                    { label: "Sanciones Económicas", value: "Evaluar el efecto de unas sanciones.", icon: Ban },
                    { label: "Diplomacia Silenciosa", value: "Comentar negociaciones que ocurren tras bambalinas.", icon: MessageCircle },
                    { label: "Energía y Poder", value: "Relacionar los recursos energéticos con el poder.", icon: Zap },
                    { label: "Escenarios a Futuro", value: "Proyectar escenarios con la debida cautela.", icon: ArrowRight }
                ]
            },
            {
                label: "Análisis Político",
                value: "Análisis de la actualidad política nacional",
                registerInstruction: "Registro analítico ponderado. Vocabulario político preciso. Neutralidad activa.",
                icon: Vote,
                actions: [
                    { label: "El Mapa de Fuerzas", value: "Describir el equilibrio de poder entre partidos.", icon: PieChart },
                    { label: "Un Discurso Clave", value: "Analizar el subtexto de un discurso importante.", icon: Megaphone },
                    { label: "Encuestas y Realidad", value: "Interpretar encuestas con sentido crítico.", icon: LineChart },
                    { label: "Pactos y Rupturas", value: "Explicar una negociación o ruptura entre aliados.", icon: Handshake },
                    { label: "El Voto Indeciso", value: "Analizar el peso del electorado indeciso.", icon: HelpCircle },
                    { label: "Estrategia y Relato", value: "Distinguir la estrategia real del relato público.", icon: Eye }
                ]
            },
            {
                label: "Ciencia Avanzada",
                value: "Divulgación de ciencia de frontera",
                registerInstruction: "Registro divulgativo riguroso. Explicar lo complejo con precisión. Entusiasmo controlado.",
                icon: FlaskConical,
                actions: [
                    { label: "Un Descubrimiento", value: "Explicar un hallazgo científico y su relevancia.", icon: Lightbulb },
                    { label: "El Método", value: "Describir cómo se llegó a una conclusión.", icon: ListChecks },
                    { label: "Aplicaciones Futuras", value: "Anticipar usos posibles de un avance.", icon: Rocket },
                    { label: "Los Límites del Estudio", value: "Señalar con honestidad las limitaciones.", icon: Scale },
                    { label: "Ciencia y Sociedad", value: "Relacionar el avance con dilemas sociales.", icon: Users },
                    { label: "Consenso y Debate", value: "Distinguir el consenso científico del debate abierto.", icon: MessageCircle }
                ]
            },
            {
                label: "Cultura y Crítica",
                value: "Crítica cultural de una obra o fenómeno",
                registerInstruction: "Registro culto y valorativo. Vocabulario estético, ironía fina. Argumentación sólida.",
                icon: Palette,
                actions: [
                    { label: "Situar la Obra", value: "Contextualizar una obra en su corriente y época.", icon: BookOpen },
                    { label: "Un Juicio de Valor", value: "Argumentar por qué una obra funciona o no.", icon: Scale },
                    { label: "Fenómeno de Masas", value: "Analizar por qué algo se vuelve popular.", icon: Users },
                    { label: "Forma y Fondo", value: "Distinguir el mérito formal del contenido.", icon: Eye },
                    { label: "La Polémica", value: "Comentar una controversia cultural con matices.", icon: Drama },
                    { label: "Legado y Actualidad", value: "Evaluar la vigencia de una obra clásica.", icon: Landmark }
                ]
            },
            {
                label: "Tecnología y Ética",
                value: "Reportaje sobre dilemas éticos de la tecnología",
                registerInstruction: "Registro reflexivo e informado. Vocabulario técnico y ético. Equilibrio crítico.",
                icon: Server,
                actions: [
                    { label: "Algoritmos que Deciden", value: "Analizar decisiones automatizadas y sus sesgos.", icon: Brain },
                    { label: "Privacidad y Vigilancia", value: "Debatir el equilibrio entre seguridad y privacidad.", icon: Eye },
                    { label: "Empleo y Automatización", value: "Evaluar el impacto de la automatización en el trabajo.", icon: Briefcase },
                    { label: "Desinformación", value: "Explicar cómo se propaga la desinformación.", icon: Ghost },
                    { label: "Regular la Tecnología", value: "Comentar intentos de regular a las grandes empresas.", icon: Gavel },
                    { label: "Poder Concentrado", value: "Analizar la concentración de poder tecnológico.", icon: Server }
                ]
            },
            {
                label: "Salud Pública",
                value: "Análisis de políticas y desafíos de salud pública",
                registerInstruction: "Registro riguroso y responsable. Datos epidemiológicos accesibles. Prudencia.",
                icon: Stethoscope,
                actions: [
                    { label: "Una Campaña Nacional", value: "Analizar una gran campaña de salud y su alcance.", icon: Megaphone },
                    { label: "Desigualdad en la Salud", value: "Explicar cómo la desigualdad afecta a la salud.", icon: Scale },
                    { label: "Prevención vs. Cura", value: "Debatir la inversión en prevención.", icon: ShieldAlert },
                    { label: "Datos y Decisiones", value: "Mostrar cómo los datos guían las políticas.", icon: LineChart },
                    { label: "Salud Mental Colectiva", value: "Analizar el estado de la salud mental de la población.", icon: Brain },
                    { label: "El Sistema Bajo Presión", value: "Evaluar la sostenibilidad del sistema sanitario.", icon: Stethoscope }
                ]
            },
            {
                label: "Debate Electoral",
                value: "Cobertura y análisis de una campaña electoral",
                registerInstruction: "Registro analítico equilibrado. Retórica de campaña, verificación de datos. Imparcialidad.",
                icon: Megaphone,
                actions: [
                    { label: "Las Propuestas", value: "Comparar las propuestas centrales de los candidatos.", icon: ListChecks },
                    { label: "Verificar Promesas", value: "Contrastar afirmaciones de campaña con los hechos.", icon: CheckCircle },
                    { label: "El Cara a Cara", value: "Analizar un debate televisado y sus golpes.", icon: Tv },
                    { label: "El Tono de la Campaña", value: "Comentar la crispación o el respeto en la campaña.", icon: Volume2 },
                    { label: "El Papel de los Medios", value: "Reflexionar sobre la cobertura mediática.", icon: Newspaper },
                    { label: "La Jornada de Votación", value: "Explicar el proceso y la participación esperada.", icon: Vote }
                ]
            }
        ]
    },
    [TextType.PodcastInterview]: {
        [Level.Beginner]: [
            {
                label: "Mi Rutina Diaria",
                value: "Un entrevistador pregunta a un invitado por su día a día",
                registerInstruction: "Registro informal y cercano entre dos personas. Presente y vocabulario cotidiano. Sin jerga.",
                icon: Sun,
                actions: [
                    { label: "Cómo Empieza el Día", value: "El invitado cuenta a qué hora se levanta y qué hace primero.", icon: Coffee },
                    { label: "El Trabajo o el Estudio", value: "Describe cómo es su mañana de trabajo o estudio.", icon: Briefcase },
                    { label: "La Comida", value: "Cuenta qué suele comer y con quién.", icon: Utensils },
                    { label: "El Tiempo Libre", value: "Explica qué hace por la tarde para relajarse.", icon: Music },
                    { label: "El Fin de Semana", value: "Compara su rutina de semana con la del fin de semana.", icon: Calendar },
                    { label: "Antes de Dormir", value: "Describe qué hace justo antes de acostarse.", icon: Moon }
                ]
            },
            {
                label: "Mi Ciudad Favorita",
                value: "Entrevista sobre una ciudad que el invitado adora",
                registerInstruction: "Registro informal y descriptivo. Vocabulario de lugares. Frases sencillas.",
                icon: MapPin,
                actions: [
                    { label: "Por Qué Le Gusta", value: "Explica qué hace especial a esa ciudad.", icon: Heart },
                    { label: "Un Lugar Imperdible", value: "Recomienda un sitio que hay que visitar.", icon: Star },
                    { label: "La Comida Típica", value: "Describe un plato típico del lugar.", icon: Utensils },
                    { label: "Moverse por la Ciudad", value: "Cuenta cómo es el transporte allí.", icon: Bus },
                    { label: "La Gente", value: "Describe cómo es la gente de esa ciudad.", icon: Users },
                    { label: "Un Consejo para Viajar", value: "Da un consejo para quien la visite por primera vez.", icon: Lightbulb }
                ]
            },
            {
                label: "Aprendí a Cocinar",
                value: "Entrevista sobre cómo el invitado aprendió a cocinar",
                registerInstruction: "Registro informal y ameno. Pretérito básico y presente. Vocabulario de cocina simple.",
                icon: Utensils,
                actions: [
                    { label: "El Primer Plato", value: "Cuenta cuál fue el primer plato que aprendió.", icon: Menu },
                    { label: "Quién le Enseñó", value: "Explica quién le enseñó a cocinar.", icon: Heart },
                    { label: "Un Desastre en la Cocina", value: "Recuerda una vez que algo salió mal.", icon: AlertCircle },
                    { label: "Su Plato Estrella", value: "Describe el plato que mejor le sale.", icon: Star },
                    { label: "Ingredientes Favoritos", value: "Cuenta qué ingredientes le encanta usar.", icon: Apple },
                    { label: "Cocinar para Otros", value: "Explica qué siente al cocinar para su familia.", icon: Users }
                ]
            },
            {
                label: "Mi Primera Mascota",
                value: "Entrevista sobre la primera mascota del invitado",
                registerInstruction: "Registro informal y tierno. Pretérito y presente básicos. Vocabulario de animales.",
                icon: Dog,
                actions: [
                    { label: "Cómo Llegó", value: "Cuenta cómo consiguió a su primera mascota.", icon: Gift },
                    { label: "Su Nombre y Carácter", value: "Describe el nombre y la personalidad del animal.", icon: Smile },
                    { label: "Una Travesura", value: "Recuerda una travesura divertida de la mascota.", icon: Zap },
                    { label: "El Cuidado Diario", value: "Explica cómo cuidaba a su mascota.", icon: Heart },
                    { label: "Un Recuerdo Especial", value: "Comparte un momento inolvidable juntos.", icon: Star },
                    { label: "Lo que Aprendió", value: "Cuenta qué aprendió de tener una mascota.", icon: Lightbulb }
                ]
            },
            {
                label: "Mi Trabajo Actual",
                value: "Entrevista sobre el trabajo que hace el invitado",
                registerInstruction: "Registro informal-profesional. Presente y vocabulario laboral básico. Claridad.",
                icon: Briefcase,
                actions: [
                    { label: "En Qué Consiste", value: "Explica de forma sencilla en qué trabaja.", icon: ListChecks },
                    { label: "Un Día Normal", value: "Describe cómo es un día típico en su trabajo.", icon: Clock },
                    { label: "Lo que Más le Gusta", value: "Cuenta la parte que más disfruta.", icon: ThumbsUp },
                    { label: "Lo Más Difícil", value: "Explica qué le resulta más difícil.", icon: AlertCircle },
                    { label: "Sus Compañeros", value: "Describe cómo es el equipo con el que trabaja.", icon: Users },
                    { label: "Un Sueño Profesional", value: "Comparte qué le gustaría hacer en el futuro.", icon: Star }
                ]
            },
            {
                label: "Un Viaje Reciente",
                value: "Entrevista sobre un viaje que hizo el invitado",
                registerInstruction: "Registro informal narrativo. Pretérito básico. Vocabulario de viajes sencillo.",
                icon: Plane,
                actions: [
                    { label: "A Dónde Fue", value: "Cuenta a dónde viajó y con quién.", icon: MapPin },
                    { label: "El Viaje de Ida", value: "Describe cómo fue llegar hasta allí.", icon: Plane },
                    { label: "Lo que Más le Gustó", value: "Explica qué fue lo mejor del viaje.", icon: Heart },
                    { label: "Una Sorpresa", value: "Recuerda algo inesperado que le pasó.", icon: Sparkles },
                    { label: "La Comida del Lugar", value: "Cuenta qué comió y si le gustó.", icon: Utensils },
                    { label: "Volver a Casa", value: "Describe cómo se sintió al volver.", icon: Home }
                ]
            },
            {
                label: "Mi Pasatiempo",
                value: "Entrevista sobre el pasatiempo favorito del invitado",
                registerInstruction: "Registro informal y entusiasta. Presente y vocabulario de aficiones. Frases claras.",
                icon: Music,
                actions: [
                    { label: "Cómo Empezó", value: "Cuenta cómo descubrió su pasatiempo.", icon: Lightbulb },
                    { label: "Con Qué Frecuencia", value: "Explica cada cuánto lo practica.", icon: Calendar },
                    { label: "Lo que Necesita", value: "Describe qué materiales o cosas usa.", icon: Package },
                    { label: "Un Logro Pequeño", value: "Comparte algo que consiguió con su afición.", icon: Trophy },
                    { label: "Con Quién lo Comparte", value: "Cuenta si lo hace solo o con otros.", icon: Users },
                    { label: "Por Qué le Gusta", value: "Explica qué siente cuando lo practica.", icon: Heart }
                ]
            },
            {
                label: "Mi Familia",
                value: "Entrevista sobre la familia del invitado",
                registerInstruction: "Registro informal y cálido. Presente y vocabulario familiar. Sin temas delicados.",
                icon: Users,
                actions: [
                    { label: "Quiénes Son", value: "Presenta a los miembros de su familia.", icon: Users },
                    { label: "Un Recuerdo de la Infancia", value: "Comparte un recuerdo bonito de pequeño.", icon: Baby },
                    { label: "Una Tradición Familiar", value: "Describe una costumbre que hacen juntos.", icon: Gift },
                    { label: "La Comida en Familia", value: "Cuenta cómo son las comidas familiares.", icon: Utensils },
                    { label: "A Quién se Parece", value: "Explica a quién se parece y en qué.", icon: Smile },
                    { label: "Lo que Más Valora", value: "Dice qué aprecia más de su familia.", icon: Heart }
                ]
            },
            {
                label: "Cómo Cambié de Casa",
                value: "Entrevista sobre una mudanza del invitado",
                registerInstruction: "Registro informal narrativo. Pretérito y presente. Vocabulario del hogar.",
                icon: Home,
                actions: [
                    { label: "Por Qué se Mudó", value: "Explica el motivo de la mudanza.", icon: ArrowRight },
                    { label: "El Día de la Mudanza", value: "Cuenta cómo fue ese día tan movido.", icon: Truck },
                    { label: "La Casa Nueva", value: "Describe cómo es su nueva casa.", icon: Home },
                    { label: "El Barrio", value: "Habla de cómo es el nuevo barrio.", icon: MapPin },
                    { label: "Lo que Extraña", value: "Cuenta qué echa de menos de antes.", icon: Frown },
                    { label: "Lo que Ganó", value: "Explica qué mejoró con el cambio.", icon: ThumbsUp }
                ]
            },
            {
                label: "Mi Deporte Favorito",
                value: "Entrevista sobre el deporte que practica el invitado",
                registerInstruction: "Registro informal y dinámico. Presente y vocabulario deportivo básico. Entusiasmo.",
                icon: Dumbbell,
                actions: [
                    { label: "Qué Deporte Practica", value: "Cuenta qué deporte hace y desde cuándo.", icon: Dumbbell },
                    { label: "Cómo lo Descubrió", value: "Explica cómo empezó a practicarlo.", icon: Lightbulb },
                    { label: "Su Rutina", value: "Describe cuándo y dónde entrena.", icon: Clock },
                    { label: "Un Buen Momento", value: "Comparte un partido o logro que recuerda.", icon: Trophy },
                    { label: "Lo Difícil", value: "Cuenta qué le cuesta más de ese deporte.", icon: AlertCircle },
                    { label: "Un Consejo", value: "Da un consejo a quien quiera empezar.", icon: ThumbsUp }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "El Día que Me Despidieron",
                value: "Un invitado relata cómo perdió su empleo y qué vino después",
                registerInstruction: "Registro informal reflexivo entre dos personas. Narración en pasado, emociones y opinión. Sin datos reales.",
                icon: Briefcase,
                actions: [
                    { label: "Cómo Fue el Momento", value: "Relata cómo le comunicaron el despido.", icon: X },
                    { label: "La Primera Reacción", value: "Describe qué sintió y cómo reaccionó.", icon: Frown },
                    { label: "Contárselo a los Demás", value: "Cuenta cómo se lo dijo a su familia.", icon: Users },
                    { label: "Buscar de Nuevo", value: "Explica cómo empezó a buscar otro trabajo.", icon: Search },
                    { label: "Lo que Aprendió", value: "Reflexiona sobre lo que le enseñó la experiencia.", icon: Lightbulb },
                    { label: "Cómo Está Ahora", value: "Cuenta cómo cambió su vida después.", icon: TrendingUp }
                ]
            },
            {
                label: "Emprender de Cero",
                value: "Entrevista a alguien que montó su propio negocio",
                registerInstruction: "Registro cercano y motivador. Pasado y presente, opinión. Vocabulario de negocios accesible.",
                icon: Rocket,
                actions: [
                    { label: "La Idea Inicial", value: "Cuenta cómo se le ocurrió la idea.", icon: Lightbulb },
                    { label: "Los Primeros Pasos", value: "Describe cómo empezó con poco dinero.", icon: ArrowRight },
                    { label: "El Primer Cliente", value: "Recuerda su primera venta o cliente.", icon: HandCoins },
                    { label: "Un Momento de Dudas", value: "Relata cuándo pensó en rendirse.", icon: Frown },
                    { label: "Aprender de los Errores", value: "Explica un error del que aprendió mucho.", icon: AlertCircle },
                    { label: "Consejos para Empezar", value: "Da consejos a quien quiera emprender.", icon: ThumbsUp }
                ]
            },
            {
                label: "Vivir en el Extranjero",
                value: "Entrevista a alguien que se mudó a otro país",
                registerInstruction: "Registro informal reflexivo. Narración y comparación cultural. Vocabulario intermedio.",
                icon: Globe,
                actions: [
                    { label: "Por Qué se Fue", value: "Explica qué le llevó a mudarse de país.", icon: Plane },
                    { label: "El Choque Cultural", value: "Cuenta qué le sorprendió al llegar.", icon: Sparkles },
                    { label: "El Idioma", value: "Relata cómo se manejó con otro idioma.", icon: MessageCircle },
                    { label: "Hacer Amigos", value: "Describe cómo construyó una nueva red de amigos.", icon: Users },
                    { label: "Lo que Extraña", value: "Habla de lo que echa de menos de su país.", icon: Home },
                    { label: "¿Volvería?", value: "Reflexiona sobre si volvería o se quedaría.", icon: HelpCircle }
                ]
            },
            {
                label: "Superé una Lesión",
                value: "Entrevista sobre recuperarse de una lesión importante",
                registerInstruction: "Registro cercano y honesto. Narración con emoción contenida. Vocabulario de salud accesible.",
                icon: Stethoscope,
                actions: [
                    { label: "Cómo Pasó", value: "Cuenta cómo ocurrió la lesión.", icon: AlertTriangle },
                    { label: "El Diagnóstico", value: "Relata el momento en que supo su alcance.", icon: FileText },
                    { label: "La Recuperación", value: "Describe el proceso de rehabilitación.", icon: TrendingUp },
                    { label: "El Apoyo", value: "Habla de quién le ayudó a seguir.", icon: HeartHandshake },
                    { label: "El Momento Más Duro", value: "Recuerda el peor momento del proceso.", icon: Frown },
                    { label: "La Nueva Perspectiva", value: "Explica cómo cambió su forma de ver la vida.", icon: Eye }
                ]
            },
            {
                label: "Cambié de Carrera",
                value: "Entrevista a alguien que cambió de profesión",
                registerInstruction: "Registro reflexivo y cercano. Pasado, presente y condicional simple. Opinión personal.",
                icon: ArrowRight,
                actions: [
                    { label: "La Vida Anterior", value: "Describe a qué se dedicaba antes.", icon: Briefcase },
                    { label: "La Chispa del Cambio", value: "Cuenta qué le hizo replantearse todo.", icon: Zap },
                    { label: "El Miedo a Empezar", value: "Relata sus dudas antes de dar el paso.", icon: Frown },
                    { label: "Volver a Estudiar", value: "Explica cómo se formó de nuevo.", icon: GraduationCap },
                    { label: "La Reacción de los Demás", value: "Cuenta qué le dijeron sus allegados.", icon: Users },
                    { label: "¿Valió la Pena?", value: "Reflexiona sobre si repetiría la decisión.", icon: Scale }
                ]
            },
            {
                label: "Un Estilo de Vida Nuevo",
                value: "Entrevista sobre adoptar un hábito o estilo de vida",
                registerInstruction: "Registro cercano y divulgativo. Presente y pasado, argumentación simple. Vocabulario de hábitos.",
                icon: Leaf,
                actions: [
                    { label: "El Antes", value: "Describe cómo vivía antes del cambio.", icon: Clock },
                    { label: "La Decisión", value: "Explica por qué decidió cambiar.", icon: Lightbulb },
                    { label: "Los Primeros Días", value: "Cuenta lo difícil de empezar.", icon: AlertCircle },
                    { label: "Los Beneficios", value: "Describe qué mejoró en su vida.", icon: ThumbsUp },
                    { label: "Las Críticas", value: "Relata cómo respondió a quienes dudaban.", icon: MessageCircle },
                    { label: "Mantenerlo", value: "Explica cómo sostiene el hábito hoy.", icon: CheckCircle }
                ]
            },
            {
                label: "Mi Relación a Distancia",
                value: "Entrevista sobre mantener una relación a distancia",
                registerInstruction: "Registro íntimo pero pudoroso. Narración y emoción. Vocabulario afectivo intermedio.",
                icon: Heart,
                actions: [
                    { label: "Cómo Empezó", value: "Cuenta cómo se conocieron y por qué la distancia.", icon: Sparkles },
                    { label: "El Día a Día", value: "Describe cómo mantenían el contacto.", icon: Phone },
                    { label: "Los Reencuentros", value: "Relata la emoción de volver a verse.", icon: Plane },
                    { label: "Los Momentos Difíciles", value: "Habla de las dudas y los celos.", icon: Frown },
                    { label: "La Confianza", value: "Explica cómo cuidaban la confianza.", icon: HeartHandshake },
                    { label: "El Desenlace", value: "Cuenta cómo terminó o cómo siguió.", icon: ArrowRight }
                ]
            },
            {
                label: "Aprendí un Oficio",
                value: "Entrevista a alguien que aprendió un oficio manual",
                registerInstruction: "Registro cercano y práctico. Narración y descripción de procesos. Vocabulario de oficios.",
                icon: Hammer,
                actions: [
                    { label: "Qué Oficio Aprendió", value: "Cuenta qué oficio eligió y por qué.", icon: Wrench },
                    { label: "El Maestro", value: "Describe a quién le enseñó y cómo.", icon: Users },
                    { label: "El Primer Trabajo", value: "Recuerda su primer encargo real.", icon: Package },
                    { label: "Los Errores", value: "Relata errores que le enseñaron el oficio.", icon: AlertCircle },
                    { label: "El Orgullo del Trabajo", value: "Explica qué siente al terminar una pieza.", icon: Trophy },
                    { label: "El Futuro del Oficio", value: "Reflexiona sobre el futuro de su trabajo.", icon: TrendingUp }
                ]
            },
            {
                label: "Todo Salió Mal en un Evento",
                value: "Entrevista sobre organizar un evento que fue un caos",
                registerInstruction: "Registro informal con humor. Narración en pasado, tono ligero. Vocabulario intermedio.",
                icon: AlertTriangle,
                actions: [
                    { label: "El Plan Perfecto", value: "Describe cómo lo tenía todo planeado.", icon: ListChecks },
                    { label: "El Primer Fallo", value: "Cuenta qué fue lo primero que salió mal.", icon: X },
                    { label: "El Efecto Dominó", value: "Relata cómo un problema llevó a otro.", icon: Zap },
                    { label: "Improvisar", value: "Explica cómo intentó salvar la situación.", icon: Lightbulb },
                    { label: "La Reacción de la Gente", value: "Cuenta cómo lo tomaron los asistentes.", icon: Users },
                    { label: "Reírse Después", value: "Reflexiona sobre cómo hoy se ríe de todo.", icon: Smile }
                ]
            },
            {
                label: "Convivir con Compañeros",
                value: "Entrevista sobre compartir vivienda con otras personas",
                registerInstruction: "Registro informal cotidiano. Narración y opinión. Vocabulario de convivencia.",
                icon: Home,
                actions: [
                    { label: "Cómo Empezó", value: "Cuenta por qué decidió compartir piso.", icon: DoorOpen },
                    { label: "Las Reglas de la Casa", value: "Describe las normas que acordaron.", icon: ListChecks },
                    { label: "Un Conflicto", value: "Relata un roce por la limpieza o el ruido.", icon: AlertCircle },
                    { label: "Los Buenos Momentos", value: "Habla de lo que disfrutó de convivir.", icon: Smile },
                    { label: "Aprender a Ceder", value: "Explica cómo aprendió a negociar.", icon: Handshake },
                    { label: "Lo que se Lleva", value: "Reflexiona sobre lo que aprendió de la experiencia.", icon: Lightbulb }
                ]
            },
            {
                label: "Cómo Salí de una Deuda",
                value: "Entrevista sobre superar una situación económica difícil",
                registerInstruction: "Registro honesto y cercano. Narración y consejos. Vocabulario financiero accesible.",
                icon: PiggyBank,
                actions: [
                    { label: "Cómo se Endeudó", value: "Explica cómo llegó a esa situación.", icon: TrendingUp },
                    { label: "Darse Cuenta", value: "Cuenta el momento en que asumió el problema.", icon: Eye },
                    { label: "El Plan", value: "Describe cómo organizó sus gastos.", icon: ListChecks },
                    { label: "Los Sacrificios", value: "Relata a qué tuvo que renunciar.", icon: Scale },
                    { label: "Pequeñas Victorias", value: "Habla de los avances que le motivaban.", icon: Trophy },
                    { label: "La Lección Financiera", value: "Comparte lo que aprendió sobre el dinero.", icon: Lightbulb }
                ]
            },
            {
                label: "Mi Experiencia de Voluntario",
                value: "Entrevista a alguien sobre su labor de voluntariado",
                registerInstruction: "Registro cálido y reflexivo. Narración y valoración. Vocabulario solidario intermedio.",
                icon: HeartHandshake,
                actions: [
                    { label: "Cómo Empezó", value: "Cuenta cómo llegó al voluntariado.", icon: DoorOpen },
                    { label: "Qué Hacía", value: "Describe las tareas que realizaba.", icon: ListChecks },
                    { label: "Una Historia que le Marcó", value: "Relata un encuentro que le conmovió.", icon: Heart },
                    { label: "Lo Difícil", value: "Habla de los momentos duros de ayudar.", icon: Frown },
                    { label: "Lo que Recibió", value: "Explica qué ganó él con la experiencia.", icon: Sparkles },
                    { label: "Animar a Otros", value: "Invita a los oyentes a participar.", icon: Megaphone }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Escapé de una Situación de Control",
                value: "Un invitado relata cómo salió de una relación o entorno de control",
                registerInstruction: "Registro íntimo y grave, pero contenido. Narración compleja, matices psicológicos. Sin morbo ni datos reales.",
                icon: ShieldAlert,
                actions: [
                    { label: "Cómo Empezó Todo", value: "Relata cómo no vio las señales al principio.", icon: Eye },
                    { label: "El Punto de Inflexión", value: "Describe el momento en que entendió la situación.", icon: Zap },
                    { label: "Planear la Salida", value: "Cuenta cómo preparó su salida con cuidado.", icon: ListChecks },
                    { label: "El Miedo y la Culpa", value: "Explora las emociones contradictorias que sintió.", icon: Ghost },
                    { label: "Reconstruirse", value: "Habla de cómo recuperó su autonomía.", icon: Sprout },
                    { label: "Su Mensaje Hoy", value: "Comparte una reflexión para quien lo vive.", icon: Megaphone }
                ]
            },
            {
                label: "Fui Testigo de un Hecho Grave",
                value: "Entrevista a un testigo de un acontecimiento serio",
                registerInstruction: "Registro sobrio y reflexivo. Narración precisa, dilemas morales. Prudencia y matiz.",
                icon: Eye,
                actions: [
                    { label: "El Momento", value: "Describe con detalle contenido lo que presenció.", icon: AlertOctagon },
                    { label: "La Decisión de Actuar", value: "Relata su dilema entre intervenir o no.", icon: Scale },
                    { label: "Las Consecuencias", value: "Cuenta qué pasó después para él.", icon: ArrowRight },
                    { label: "Declarar", value: "Explica cómo fue relatar los hechos oficialmente.", icon: FileText },
                    { label: "El Peso Emocional", value: "Habla de cómo le afectó psicológicamente.", icon: Brain },
                    { label: "Lo que Cambiaría", value: "Reflexiona sobre qué haría distinto.", icon: HelpCircle }
                ]
            },
            {
                label: "Cuidé a un Familiar Enfermo",
                value: "Entrevista sobre acompañar a un familiar en una enfermedad larga",
                registerInstruction: "Registro íntimo y sereno. Narración emocional madura. Vocabulario de cuidado y duelo.",
                icon: HeartHandshake,
                actions: [
                    { label: "El Diagnóstico", value: "Relata cómo recibieron la noticia.", icon: FileText },
                    { label: "Cambiar de Vida", value: "Explica cómo reorganizó su rutina para cuidar.", icon: ArrowRight },
                    { label: "Los Días Difíciles", value: "Describe el desgaste físico y emocional.", icon: BatteryLow },
                    { label: "Momentos de Ternura", value: "Comparte instantes de conexión profunda.", icon: Heart },
                    { label: "El Cuidador Olvidado", value: "Reflexiona sobre cuidar también de uno mismo.", icon: Users },
                    { label: "Lo que Queda", value: "Habla de lo que aprendió sobre la vida.", icon: Sprout }
                ]
            },
            {
                label: "Sobreviví a un Desastre",
                value: "Entrevista a alguien que vivió un desastre natural",
                registerInstruction: "Registro intenso pero mesurado. Narración vívida, reflexión. Vocabulario amplio.",
                icon: Umbrella,
                actions: [
                    { label: "Los Primeros Signos", value: "Relata las señales previas al desastre.", icon: AlertTriangle },
                    { label: "El Momento Crítico", value: "Describe la hora más peligrosa.", icon: Waves },
                    { label: "La Comunidad", value: "Cuenta cómo la gente se ayudó entre sí.", icon: Users },
                    { label: "La Pérdida", value: "Habla de lo que perdió y cómo lo asumió.", icon: Frown },
                    { label: "Reconstruir", value: "Explica el largo proceso de volver a empezar.", icon: Hammer },
                    { label: "Otra Mirada sobre la Vida", value: "Reflexiona sobre qué es esencial ahora.", icon: Eye }
                ]
            },
            {
                label: "Denuncié Malas Prácticas",
                value: "Entrevista a alguien que denunció irregularidades en su empresa",
                registerInstruction: "Registro serio y ético. Narración argumentada, dilemas. Vocabulario laboral y legal.",
                icon: FileWarning,
                actions: [
                    { label: "Lo que Descubrió", value: "Explica qué irregularidad detectó.", icon: Search },
                    { label: "El Dilema Moral", value: "Relata su lucha entre callar o denunciar.", icon: Scale },
                    { label: "Dar el Paso", value: "Cuenta cómo y ante quién denunció.", icon: Megaphone },
                    { label: "Las Represalias", value: "Describe las consecuencias que enfrentó.", icon: AlertTriangle },
                    { label: "El Apoyo y la Soledad", value: "Habla de quién le apoyó y quién le dio la espalda.", icon: Users },
                    { label: "¿Lo Volvería a Hacer?", value: "Reflexiona sobre el precio de la integridad.", icon: HelpCircle }
                ]
            },
            {
                label: "Reconstruí mi Identidad",
                value: "Entrevista sobre reinventarse tras una crisis personal",
                registerInstruction: "Registro reflexivo y maduro. Narración introspectiva, abstracción. Vocabulario rico.",
                icon: Sparkles,
                actions: [
                    { label: "La Vida que Se Rompió", value: "Describe la crisis que lo cambió todo.", icon: X },
                    { label: "Tocar Fondo", value: "Relata el momento más bajo con honestidad.", icon: Frown },
                    { label: "La Pregunta Clave", value: "Cuenta la pregunta que se hizo a sí mismo.", icon: HelpCircle },
                    { label: "Pequeños Pasos", value: "Explica cómo empezó a reconstruirse.", icon: Sprout },
                    { label: "Una Nueva Definición", value: "Habla de cómo redefinió quién es.", icon: Eye },
                    { label: "El Sentido", value: "Reflexiona sobre lo que da sentido a su vida.", icon: Star }
                ]
            },
            {
                label: "La Fama y sus Costos",
                value: "Entrevista a alguien que vivió una exposición pública intensa",
                registerInstruction: "Registro reflexivo y algo desencantado. Análisis de la exposición pública. Ironía madura.",
                icon: Star,
                actions: [
                    { label: "El Ascenso", value: "Relata cómo llegó la atención repentina.", icon: TrendingUp },
                    { label: "La Cara B", value: "Describe el lado oscuro de la exposición.", icon: Moon },
                    { label: "Perder la Privacidad", value: "Habla de vivir bajo la mirada ajena.", icon: Eye },
                    { label: "Las Críticas", value: "Explica cómo aprendió a convivir con el juicio.", icon: MessageCircle },
                    { label: "Quién Sos sin Eso", value: "Reflexiona sobre su identidad más allá de la fama.", icon: Ghost },
                    { label: "Un Consejo Sincero", value: "Comparte una advertencia honesta.", icon: Lightbulb }
                ]
            },
            {
                label: "Rechazos Antes de Publicar",
                value: "Entrevista a un autor rechazado muchas veces antes de triunfar",
                registerInstruction: "Registro cálido y perseverante. Narración con humor e ironía. Vocabulario literario.",
                icon: BookOpen,
                actions: [
                    { label: "El Primer Manuscrito", value: "Cuenta cómo nació su primera obra.", icon: Feather },
                    { label: "La Colección de 'No'", value: "Relata con humor los rechazos acumulados.", icon: X },
                    { label: "La Duda", value: "Describe cuándo pensó en abandonar.", icon: Frown },
                    { label: "Seguir Escribiendo", value: "Explica qué le hacía continuar.", icon: Sprout },
                    { label: "El 'Sí'", value: "Relata el momento en que le aceptaron.", icon: CheckCircle },
                    { label: "Qué le Diría a su Yo de Antes", value: "Reflexiona sobre la perseverancia.", icon: Clock }
                ]
            },
            {
                label: "Ética en las Decisiones",
                value: "Entrevista a un profesional sobre dilemas éticos de su trabajo",
                registerInstruction: "Registro intelectual y ponderado. Argumentación abstracta, matices. Vocabulario especializado.",
                icon: Scale,
                actions: [
                    { label: "Un Caso Concreto", value: "Plantea un dilema real de su profesión.", icon: HelpCircle },
                    { label: "Las Dos Caras", value: "Expone los argumentos de cada lado.", icon: Scale },
                    { label: "La Presión", value: "Relata las presiones que complican decidir.", icon: AlertTriangle },
                    { label: "La Línea Roja", value: "Explica dónde pone su límite y por qué.", icon: Ban },
                    { label: "Vivir con la Decisión", value: "Habla de asumir las consecuencias.", icon: Brain },
                    { label: "Enseñar a Decidir", value: "Reflexiona sobre cómo se forma el criterio ético.", icon: GraduationCap }
                ]
            },
            {
                label: "Migrar y Empezar de Nuevo",
                value: "Entrevista sobre migrar y rehacer la vida en otro lugar",
                registerInstruction: "Registro emotivo y reflexivo. Narración compleja, identidad y pertenencia. Vocabulario amplio.",
                icon: Plane,
                actions: [
                    { label: "La Decisión de Partir", value: "Explica qué le empujó a migrar.", icon: DoorOpen },
                    { label: "El Duelo Migratorio", value: "Describe lo que dejó atrás.", icon: Frown },
                    { label: "Los Trámites y las Puertas", value: "Relata las barreras burocráticas.", icon: FileText },
                    { label: "Entre Dos Mundos", value: "Habla de sentirse de aquí y de allá.", icon: Globe },
                    { label: "Echar Raíces", value: "Cuenta cómo construyó un nuevo hogar.", icon: Sprout },
                    { label: "La Identidad", value: "Reflexiona sobre quién es tras el viaje.", icon: Eye }
                ]
            },
            {
                label: "La Enfermedad que Me Cambió",
                value: "Entrevista sobre convivir con una enfermedad crónica",
                registerInstruction: "Registro íntimo y sereno. Narración madura, resiliencia. Vocabulario de salud avanzado.",
                icon: Stethoscope,
                actions: [
                    { label: "Los Primeros Síntomas", value: "Relata cómo empezó todo.", icon: Thermometer },
                    { label: "El Diagnóstico", value: "Describe el impacto de conocer su condición.", icon: FileText },
                    { label: "Reaprender a Vivir", value: "Explica cómo adaptó su vida diaria.", icon: ArrowRight },
                    { label: "El Estigma", value: "Habla de los prejuicios que enfrentó.", icon: Eye },
                    { label: "Lo que Ganó", value: "Comparte lo que la enfermedad le enseñó.", icon: Sprout },
                    { label: "Su Voz", value: "Reflexiona sobre visibilizar su experiencia.", icon: Megaphone }
                ]
            },
            {
                label: "Perdón y Reconciliación",
                value: "Entrevista sobre reconciliarse tras un conflicto familiar largo",
                registerInstruction: "Registro íntimo y matizado. Narración emocional compleja. Vocabulario afectivo rico.",
                icon: HeartHandshake,
                actions: [
                    { label: "La Herida", value: "Relata el origen del distanciamiento.", icon: Frown },
                    { label: "Los Años de Silencio", value: "Describe cómo fue la distancia.", icon: Volume2 },
                    { label: "El Primer Gesto", value: "Cuenta quién y cómo tendió la mano.", icon: Hand },
                    { label: "Perdonar de Verdad", value: "Reflexiona sobre qué significa perdonar.", icon: Heart },
                    { label: "Lo que No se Recupera", value: "Habla de lo que ya no volverá a ser igual.", icon: Clock },
                    { label: "La Paz Posible", value: "Explica cómo es su relación hoy.", icon: Sprout }
                ]
            }
        ]
    },
    [TextType.Monologue]: {
        [Level.Beginner]: [
            {
                label: "Un Día Cualquiera",
                value: "Una persona narra en primera persona cómo es un día normal de su vida",
                registerInstruction: "Registro informal narrativo, un solo hablante. Presente y pretérito básico. Vocabulario cotidiano.",
                icon: Sun,
                actions: [
                    { label: "La Mañana", value: "Narra cómo empieza su mañana paso a paso.", icon: Coffee },
                    { label: "Ir al Trabajo", value: "Cuenta cómo va al trabajo o al estudio.", icon: Bus },
                    { label: "La Hora de Comer", value: "Describe qué come y con quién.", icon: Utensils },
                    { label: "La Tarde", value: "Relata qué hace por la tarde.", icon: Clock },
                    { label: "Un Momento Favorito", value: "Comparte su momento preferido del día.", icon: Heart },
                    { label: "La Noche", value: "Cuenta cómo termina el día.", icon: Moon }
                ]
            },
            {
                label: "Mi Comida Favorita",
                value: "Alguien narra por qué ama un plato en particular",
                registerInstruction: "Registro informal y sensorial. Presente y vocabulario de comida. Frases claras.",
                icon: Utensils,
                actions: [
                    { label: "Qué Plato Es", value: "Presenta cuál es su comida favorita.", icon: Menu },
                    { label: "A Qué Sabe", value: "Describe el sabor y el olor.", icon: Sparkles },
                    { label: "Quién lo Prepara", value: "Cuenta quién lo cocina mejor.", icon: Heart },
                    { label: "Cuándo lo Come", value: "Explica en qué ocasiones lo disfruta.", icon: Calendar },
                    { label: "Un Recuerdo", value: "Comparte un recuerdo ligado a ese plato.", icon: Star },
                    { label: "La Receta Simple", value: "Explica de forma sencilla cómo se hace.", icon: ListChecks }
                ]
            },
            {
                label: "Una Fiesta Familiar",
                value: "Alguien narra una celebración con su familia",
                registerInstruction: "Registro informal y cálido. Pretérito básico. Vocabulario de celebraciones.",
                icon: Gift,
                actions: [
                    { label: "La Ocasión", value: "Cuenta qué se celebraba y dónde.", icon: Calendar },
                    { label: "Quiénes Fueron", value: "Describe a la gente que asistió.", icon: Users },
                    { label: "La Comida", value: "Relata qué comieron todos juntos.", icon: Utensils },
                    { label: "La Música y el Baile", value: "Cuenta cómo fue el ambiente.", icon: Music },
                    { label: "Un Momento Divertido", value: "Recuerda algo gracioso que pasó.", icon: Smile },
                    { label: "El Final de la Fiesta", value: "Describe cómo terminó la celebración.", icon: Moon }
                ]
            },
            {
                label: "Cómo Conocí a mi Mejor Amigo",
                value: "Alguien narra el origen de una gran amistad",
                registerInstruction: "Registro informal y afectivo. Pretérito básico. Vocabulario de emociones simples.",
                icon: Users,
                actions: [
                    { label: "El Primer Encuentro", value: "Cuenta dónde y cómo se conocieron.", icon: DoorOpen },
                    { label: "La Primera Impresión", value: "Describe qué pensó al principio.", icon: Eye },
                    { label: "Algo en Común", value: "Explica qué gusto compartían.", icon: Heart },
                    { label: "Una Anécdota", value: "Relata una aventura juntos.", icon: Sparkles },
                    { label: "Por Qué es Especial", value: "Dice por qué valora tanto esa amistad.", icon: Star },
                    { label: "Hoy en Día", value: "Cuenta cómo es su amistad ahora.", icon: Smile }
                ]
            },
            {
                label: "Mi Primer Viaje",
                value: "Alguien narra el primer viaje que hizo solo o con amigos",
                registerInstruction: "Registro informal narrativo. Pretérito básico. Vocabulario de viajes sencillo.",
                icon: Plane,
                actions: [
                    { label: "El Destino", value: "Cuenta a dónde fue y con quién.", icon: MapPin },
                    { label: "Los Preparativos", value: "Describe cómo preparó el viaje.", icon: Package },
                    { label: "La Llegada", value: "Relata la emoción de llegar.", icon: Sparkles },
                    { label: "Lo que Hizo", value: "Cuenta las actividades del viaje.", icon: Camera },
                    { label: "Un Imprevisto", value: "Recuerda algo que no salió como esperaba.", icon: AlertCircle },
                    { label: "El Recuerdo", value: "Explica por qué lo recuerda con cariño.", icon: Heart }
                ]
            },
            {
                label: "Aprendí Algo Nuevo",
                value: "Alguien narra cómo aprendió una habilidad nueva",
                registerInstruction: "Registro informal y motivador. Presente y pretérito. Vocabulario de aprendizaje.",
                icon: Lightbulb,
                actions: [
                    { label: "Qué Quiso Aprender", value: "Cuenta qué decidió aprender y por qué.", icon: Star },
                    { label: "Los Primeros Intentos", value: "Describe lo difícil del comienzo.", icon: AlertCircle },
                    { label: "Cómo Practicó", value: "Explica cómo se organizó para practicar.", icon: Clock },
                    { label: "Un Pequeño Avance", value: "Relata el momento en que empezó a lograrlo.", icon: TrendingUp },
                    { label: "Quién le Ayudó", value: "Cuenta si alguien le apoyó.", icon: Users },
                    { label: "Cómo se Sintió", value: "Describe la satisfacción de lograrlo.", icon: Smile }
                ]
            },
            {
                label: "Mi Rincón Favorito",
                value: "Alguien describe su lugar preferido de la ciudad",
                registerInstruction: "Registro informal y descriptivo. Presente. Vocabulario de lugares y sensaciones.",
                icon: MapPin,
                actions: [
                    { label: "Dónde Está", value: "Presenta el lugar y dónde queda.", icon: MapPin },
                    { label: "Cómo Es", value: "Describe cómo se ve y qué hay allí.", icon: Eye },
                    { label: "Qué Hace Allí", value: "Cuenta qué suele hacer en ese lugar.", icon: BookOpen },
                    { label: "Cuándo Va", value: "Explica en qué momentos lo visita.", icon: Clock },
                    { label: "Por Qué le Gusta", value: "Dice qué siente cuando está allí.", icon: Heart },
                    { label: "Una Invitación", value: "Invita a los oyentes a conocerlo.", icon: Hand }
                ]
            },
            {
                label: "Una Mascota Especial",
                value: "Alguien narra la historia de una mascota querida",
                registerInstruction: "Registro informal y tierno. Pretérito y presente. Vocabulario de animales.",
                icon: Dog,
                actions: [
                    { label: "Cómo Llegó", value: "Cuenta cómo su mascota llegó a su vida.", icon: Gift },
                    { label: "Su Personalidad", value: "Describe cómo es el carácter del animal.", icon: Smile },
                    { label: "La Rutina Juntos", value: "Relata qué hacen a diario.", icon: Clock },
                    { label: "Una Travesura", value: "Recuerda una travesura memorable.", icon: Zap },
                    { label: "Un Momento Tierno", value: "Comparte un momento de cariño.", icon: Heart },
                    { label: "Lo que Significa", value: "Explica qué representa para él.", icon: Star }
                ]
            },
            {
                label: "Mi Fin de Semana",
                value: "Alguien narra cómo pasa un fin de semana típico",
                registerInstruction: "Registro informal relajado. Presente y pretérito básico. Vocabulario de ocio.",
                icon: Coffee,
                actions: [
                    { label: "El Sábado por la Mañana", value: "Cuenta cómo empieza el sábado.", icon: Sun },
                    { label: "Un Plan Favorito", value: "Describe su actividad preferida del fin de semana.", icon: Music },
                    { label: "Con Quién lo Pasa", value: "Explica con quién comparte esos días.", icon: Users },
                    { label: "Comer Rico", value: "Relata alguna comida especial del finde.", icon: Utensils },
                    { label: "El Domingo Tranquilo", value: "Describe cómo es su domingo.", icon: Moon },
                    { label: "Prepararse para la Semana", value: "Cuenta cómo cierra el fin de semana.", icon: Calendar }
                ]
            },
            {
                label: "Un Pequeño Logro",
                value: "Alguien narra algo que consiguió y le hizo sentir orgullo",
                registerInstruction: "Registro informal y positivo. Pretérito básico. Vocabulario de emociones y esfuerzo.",
                icon: Trophy,
                actions: [
                    { label: "Qué Consiguió", value: "Cuenta cuál fue su pequeño logro.", icon: Star },
                    { label: "El Punto de Partida", value: "Describe de dónde partía.", icon: MapPin },
                    { label: "El Esfuerzo", value: "Relata qué tuvo que hacer para lograrlo.", icon: Dumbbell },
                    { label: "Un Obstáculo", value: "Cuenta una dificultad que superó.", icon: AlertCircle },
                    { label: "El Momento del Logro", value: "Describe cómo se sintió al conseguirlo.", icon: Trophy },
                    { label: "El Siguiente Objetivo", value: "Comparte qué quiere lograr ahora.", icon: ArrowRight }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Una Decisión que Cambió Todo",
                value: "Un narrador reflexiona sobre una decisión que marcó su vida",
                registerInstruction: "Registro narrativo reflexivo, un hablante. Pasado y condicional, opinión. Discurso conectado.",
                icon: ArrowRight,
                actions: [
                    { label: "La Vida de Antes", value: "Describe cómo era su vida antes de decidir.", icon: Clock },
                    { label: "La Encrucijada", value: "Relata el momento en que tuvo que elegir.", icon: HelpCircle },
                    { label: "Las Dudas", value: "Cuenta qué le hacía dudar.", icon: Scale },
                    { label: "Dar el Paso", value: "Describe cómo tomó la decisión.", icon: Zap },
                    { label: "Las Consecuencias", value: "Explica qué cambió después.", icon: TrendingUp },
                    { label: "La Mirada de Hoy", value: "Reflexiona sobre si fue la decisión correcta.", icon: Eye }
                ]
            },
            {
                label: "Un Problema y su Solución",
                value: "Un narrador cuenta cómo resolvió un problema complicado",
                registerInstruction: "Registro narrativo claro. Pasado y presente, argumentación simple. Vocabulario intermedio.",
                icon: Lightbulb,
                actions: [
                    { label: "El Problema", value: "Describe la situación difícil que enfrentaba.", icon: AlertTriangle },
                    { label: "Por Qué Era Difícil", value: "Explica qué lo complicaba tanto.", icon: Frown },
                    { label: "Buscar Ayuda", value: "Cuenta a quién o qué recurrió.", icon: Users },
                    { label: "Probar y Fallar", value: "Relata intentos que no funcionaron.", icon: X },
                    { label: "La Solución", value: "Describe cómo finalmente lo resolvió.", icon: CheckCircle },
                    { label: "La Lección", value: "Reflexiona sobre lo que aprendió.", icon: Lightbulb }
                ]
            },
            {
                label: "Una Historia de Superación",
                value: "Un narrador cuenta cómo salió adelante tras una adversidad",
                registerInstruction: "Registro narrativo emotivo pero contenido. Pasado, opinión. Vocabulario de esfuerzo.",
                icon: TrendingUp,
                actions: [
                    { label: "El Momento Bajo", value: "Describe la situación más difícil.", icon: Frown },
                    { label: "La Chispa", value: "Cuenta qué le dio fuerzas para reaccionar.", icon: Zap },
                    { label: "El Primer Paso", value: "Relata cómo empezó a cambiar las cosas.", icon: ArrowRight },
                    { label: "Los Apoyos", value: "Explica quién le acompañó.", icon: HeartHandshake },
                    { label: "El Progreso", value: "Describe cómo fue mejorando.", icon: TrendingUp },
                    { label: "Dónde Está Hoy", value: "Reflexiona sobre su presente.", icon: Star }
                ]
            },
            {
                label: "Crónica de mi Barrio",
                value: "Un narrador describe cómo ha cambiado su barrio con los años",
                registerInstruction: "Registro descriptivo-reflexivo. Pasado y presente, comparación. Vocabulario urbano.",
                icon: Home,
                actions: [
                    { label: "El Barrio de Antes", value: "Describe cómo era el barrio años atrás.", icon: Clock },
                    { label: "Lo que Desapareció", value: "Cuenta un negocio o lugar que ya no está.", icon: X },
                    { label: "Lo Nuevo", value: "Describe lo que ha llegado al barrio.", icon: Sparkles },
                    { label: "Los Vecinos", value: "Habla de cómo cambió la gente del barrio.", icon: Users },
                    { label: "Lo que se Perdió y se Ganó", value: "Compara lo bueno y lo malo del cambio.", icon: Scale },
                    { label: "Su Deseo", value: "Reflexiona sobre cómo le gustaría que fuera.", icon: Heart }
                ]
            },
            {
                label: "El Día que Perdí Algo",
                value: "Un narrador cuenta cuando perdió algo importante",
                registerInstruction: "Registro narrativo emotivo. Pasado, emoción contenida. Vocabulario intermedio.",
                icon: Frown,
                actions: [
                    { label: "Qué Perdió", value: "Cuenta qué perdió y por qué importaba.", icon: Package },
                    { label: "Cómo Pasó", value: "Relata las circunstancias de la pérdida.", icon: AlertCircle },
                    { label: "La Búsqueda", value: "Describe cómo intentó recuperarlo.", icon: Search },
                    { label: "Aceptarlo", value: "Explica cómo asumió que no volvería.", icon: Scale },
                    { label: "Lo que Descubrió", value: "Cuenta qué aprendió de la experiencia.", icon: Eye },
                    { label: "El Valor Real", value: "Reflexiona sobre qué importa de verdad.", icon: Heart }
                ]
            },
            {
                label: "Un Viaje en Solitario",
                value: "Un narrador relata una experiencia de viajar solo",
                registerInstruction: "Registro reflexivo y vívido. Pasado, introspección. Vocabulario de viaje intermedio.",
                icon: Plane,
                actions: [
                    { label: "Decidir Ir Solo", value: "Explica por qué viajó sin compañía.", icon: DoorOpen },
                    { label: "El Miedo Inicial", value: "Cuenta sus temores antes de partir.", icon: Frown },
                    { label: "Un Encuentro", value: "Relata a alguien que conoció en el camino.", icon: Users },
                    { label: "Perderse", value: "Describe una vez que se perdió o improvisó.", icon: MapPin },
                    { label: "El Silencio", value: "Habla de lo que descubrió estando solo.", icon: Eye },
                    { label: "Volver Distinto", value: "Reflexiona sobre cómo volvió cambiado.", icon: TrendingUp }
                ]
            },
            {
                label: "Reencuentro Inesperado",
                value: "Un narrador cuenta un reencuentro con alguien del pasado",
                registerInstruction: "Registro narrativo emotivo. Pasado y presente. Vocabulario afectivo intermedio.",
                icon: Heart,
                actions: [
                    { label: "Quién Era", value: "Presenta a la persona y su historia juntos.", icon: Users },
                    { label: "La Separación", value: "Cuenta por qué se distanciaron.", icon: ArrowRight },
                    { label: "El Encuentro Casual", value: "Relata cómo volvieron a verse.", icon: Sparkles },
                    { label: "La Emoción", value: "Describe qué sintió en ese momento.", icon: Heart },
                    { label: "Ponerse al Día", value: "Cuenta qué había cambiado en cada uno.", icon: MessageCircle },
                    { label: "Qué Quedó", value: "Reflexiona sobre el sentido del reencuentro.", icon: Star }
                ]
            },
            {
                label: "Cambié de Trabajo",
                value: "Un narrador relata su transición a un nuevo empleo",
                registerInstruction: "Registro reflexivo profesional. Pasado y presente, valoración. Vocabulario laboral.",
                icon: Briefcase,
                actions: [
                    { label: "El Trabajo Anterior", value: "Describe cómo era su empleo previo.", icon: Clock },
                    { label: "Por Qué se Fue", value: "Explica qué le motivó a cambiar.", icon: ArrowRight },
                    { label: "La Búsqueda", value: "Relata el proceso de buscar y postular.", icon: Search },
                    { label: "Los Primeros Días", value: "Cuenta cómo fue adaptarse.", icon: DoorOpen },
                    { label: "Lo que Ganó", value: "Describe las mejoras del cambio.", icon: ThumbsUp },
                    { label: "Lo que Extraña", value: "Reflexiona sobre lo que dejó atrás.", icon: Frown }
                ]
            },
            {
                label: "Un Proyecto Personal",
                value: "Un narrador cuenta un proyecto creativo que emprendió",
                registerInstruction: "Registro entusiasta y reflexivo. Pasado y presente. Vocabulario de creatividad.",
                icon: Palette,
                actions: [
                    { label: "La Idea", value: "Cuenta cómo surgió el proyecto.", icon: Lightbulb },
                    { label: "Empezar de Cero", value: "Describe los primeros pasos.", icon: Sprout },
                    { label: "Los Obstáculos", value: "Relata las dificultades que encontró.", icon: AlertTriangle },
                    { label: "Mantener la Motivación", value: "Explica cómo siguió adelante.", icon: Zap },
                    { label: "El Resultado", value: "Describe en qué se convirtió el proyecto.", icon: Trophy },
                    { label: "Lo que Aprendió", value: "Reflexiona sobre lo que descubrió de sí mismo.", icon: Eye }
                ]
            },
            {
                label: "La Vez que Me Equivoqué",
                value: "Un narrador reflexiona sobre un error que cometió",
                registerInstruction: "Registro honesto y reflexivo. Pasado, autocrítica. Vocabulario intermedio.",
                icon: AlertCircle,
                actions: [
                    { label: "El Error", value: "Cuenta qué error cometió.", icon: X },
                    { label: "Cómo Pasó", value: "Explica las circunstancias que lo llevaron a fallar.", icon: AlertTriangle },
                    { label: "Darse Cuenta", value: "Relata el momento en que lo comprendió.", icon: Eye },
                    { label: "Las Consecuencias", value: "Describe qué provocó su error.", icon: ArrowRight },
                    { label: "Pedir Disculpas", value: "Cuenta cómo intentó repararlo.", icon: Hand },
                    { label: "La Enseñanza", value: "Reflexiona sobre lo que le dejó.", icon: Lightbulb }
                ]
            },
            {
                label: "Una Tradición que Heredé",
                value: "Un narrador cuenta una costumbre familiar que continúa",
                registerInstruction: "Registro cálido y reflexivo. Pasado y presente. Vocabulario cultural intermedio.",
                icon: Sparkles,
                actions: [
                    { label: "Qué Tradición Es", value: "Presenta la costumbre y su origen.", icon: Gift },
                    { label: "De Dónde Viene", value: "Cuenta quién se la transmitió.", icon: Users },
                    { label: "Cómo se Celebra", value: "Describe cómo la practican.", icon: Calendar },
                    { label: "Un Recuerdo", value: "Comparte un momento ligado a ella.", icon: Heart },
                    { label: "Adaptarla a Hoy", value: "Explica cómo la mantiene viva.", icon: ArrowRight },
                    { label: "Por Qué Importa", value: "Reflexiona sobre su valor.", icon: Star }
                ]
            },
            {
                label: "Lo que Aprendí de un Fracaso",
                value: "Un narrador reflexiona sobre algo que salió mal y le enseñó",
                registerInstruction: "Registro reflexivo y maduro. Pasado, análisis. Vocabulario intermedio-alto.",
                icon: Ban,
                actions: [
                    { label: "El Sueño", value: "Cuenta qué quería lograr.", icon: Star },
                    { label: "El Plan", value: "Describe cómo intentó conseguirlo.", icon: ListChecks },
                    { label: "El Fracaso", value: "Relata cómo y por qué falló.", icon: X },
                    { label: "El Golpe", value: "Explica cómo se sintió al fracasar.", icon: Frown },
                    { label: "Levantarse", value: "Cuenta cómo se recuperó.", icon: TrendingUp },
                    { label: "El Regalo Oculto", value: "Reflexiona sobre lo bueno que sacó de todo.", icon: Sparkles }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Ensayo Personal",
                value: "Un narrador desarrolla una reflexión ensayística sobre un tema abstracto",
                registerInstruction: "Registro culto y reflexivo, un hablante. Argumentación, abstracción y matiz. Cohesión elaborada.",
                icon: Feather,
                actions: [
                    { label: "La Pregunta de Fondo", value: "Plantea la pregunta que vertebra el ensayo.", icon: HelpCircle },
                    { label: "Una Experiencia Propia", value: "Ancla la idea en una vivencia personal.", icon: Eye },
                    { label: "El Giro", value: "Introduce una idea que complica lo anterior.", icon: ArrowRight },
                    { label: "La Contradicción", value: "Explora una tensión sin resolverla del todo.", icon: Scale },
                    { label: "Una Imagen", value: "Usa una metáfora para iluminar la idea.", icon: Sparkles },
                    { label: "El Cierre Abierto", value: "Cierra dejando una reflexión suspendida.", icon: Moon }
                ]
            },
            {
                label: "Confesión y Catarsis",
                value: "Un narrador confiesa algo íntimo en un monólogo intenso",
                registerInstruction: "Registro íntimo e intenso pero controlado. Introspección, subtexto. Vocabulario emocional rico.",
                icon: Ghost,
                actions: [
                    { label: "El Secreto", value: "Revela lo que ha guardado durante tiempo.", icon: Lock },
                    { label: "El Peso", value: "Describe cómo le ha afectado callarlo.", icon: BatteryLow },
                    { label: "La Justificación", value: "Explora por qué lo hizo o lo calló.", icon: Scale },
                    { label: "La Vergüenza", value: "Enfrenta el juicio propio y ajeno.", icon: Eye },
                    { label: "El Alivio", value: "Relata la liberación de decirlo por fin.", icon: Wind },
                    { label: "La Reconciliación Consigo Mismo", value: "Reflexiona sobre perdonarse.", icon: Sprout }
                ]
            },
            {
                label: "Crónica de Investigación",
                value: "Un narrador relata en primera persona una investigación que llevó a cabo",
                registerInstruction: "Registro narrativo-periodístico cuidado. Rigor y suspenso, matiz. Vocabulario amplio.",
                icon: Search,
                actions: [
                    { label: "La Sospecha Inicial", value: "Cuenta qué le hizo empezar a indagar.", icon: Eye },
                    { label: "Las Primeras Pistas", value: "Relata los primeros hallazgos.", icon: Lightbulb },
                    { label: "El Callejón sin Salida", value: "Describe un obstáculo que casi lo detiene.", icon: Ban },
                    { label: "La Pieza Clave", value: "Narra el descubrimiento decisivo.", icon: Key },
                    { label: "Las Implicaciones", value: "Explica qué reveló su investigación.", icon: Zap },
                    { label: "El Precio de Saber", value: "Reflexiona sobre lo que le costó averiguarlo.", icon: Scale }
                ]
            },
            {
                label: "Relato Literario",
                value: "Un narrador cuenta un relato con voluntad estética",
                registerInstruction: "Registro literario. Recursos narrativos, imágenes, ritmo. Vocabulario rico y preciso.",
                icon: BookOpen,
                actions: [
                    { label: "La Atmósfera", value: "Construye el ambiente con detalles sensoriales.", icon: Cloud },
                    { label: "El Personaje", value: "Presenta a alguien con una pincelada precisa.", icon: Users },
                    { label: "El Conflicto", value: "Introduce la tensión que mueve el relato.", icon: Zap },
                    { label: "El Punto de Giro", value: "Narra el momento que lo cambia todo.", icon: ArrowRight },
                    { label: "El Clímax", value: "Lleva la historia a su punto más alto.", icon: Sparkles },
                    { label: "El Desenlace", value: "Cierra el relato con un eco final.", icon: Moon }
                ]
            },
            {
                label: "Discurso Motivacional",
                value: "Un orador pronuncia un discurso para inspirar a la audiencia",
                registerInstruction: "Registro persuasivo y enérgico. Retórica, anáfora, apelación. Vocabulario elevado.",
                icon: Megaphone,
                actions: [
                    { label: "El Enganche", value: "Abre con una historia o pregunta que atrapa.", icon: Zap },
                    { label: "El Obstáculo Común", value: "Nombra el miedo que todos comparten.", icon: AlertTriangle },
                    { label: "El Cambio de Marco", value: "Ofrece una nueva forma de ver el problema.", icon: Eye },
                    { label: "La Prueba", value: "Refuerza con un ejemplo poderoso.", icon: Trophy },
                    { label: "El Llamado a la Acción", value: "Invita a la audiencia a actuar.", icon: Flag },
                    { label: "El Cierre Memorable", value: "Termina con una frase que perdura.", icon: Star }
                ]
            },
            {
                label: "Análisis Social",
                value: "Un narrador analiza un fenómeno de la sociedad actual",
                registerInstruction: "Registro ensayístico y analítico. Argumentación, datos y crítica. Vocabulario sociológico.",
                icon: Users,
                actions: [
                    { label: "El Fenómeno", value: "Describe el comportamiento social que analiza.", icon: Eye },
                    { label: "Las Causas", value: "Explora por qué ocurre.", icon: HelpCircle },
                    { label: "Los Datos", value: "Apoya su análisis con evidencia.", icon: LineChart },
                    { label: "Las Voces en Disputa", value: "Presenta interpretaciones enfrentadas.", icon: MessageCircle },
                    { label: "Las Consecuencias", value: "Analiza el impacto a futuro.", icon: ArrowRight },
                    { label: "Una Propuesta", value: "Sugiere una vía posible con matices.", icon: Lightbulb }
                ]
            },
            {
                label: "Memoria Histórica",
                value: "Un narrador rememora un momento histórico que vivió o heredó",
                registerInstruction: "Registro evocador y solemne. Narración con perspectiva histórica. Vocabulario rico.",
                icon: Landmark,
                actions: [
                    { label: "El Contexto", value: "Sitúa la época y lo que se vivía.", icon: Clock },
                    { label: "El Testimonio", value: "Relata lo que él o su familia vivieron.", icon: Users },
                    { label: "El Detalle que Perdura", value: "Rescata un detalle cotidiano revelador.", icon: Eye },
                    { label: "La Herida", value: "Aborda lo doloroso con respeto.", icon: Frown },
                    { label: "La Transmisión", value: "Explica por qué es importante recordar.", icon: BookOpen },
                    { label: "El Deber de Memoria", value: "Reflexiona sobre no olvidar.", icon: Flag }
                ]
            },
            {
                label: "Monólogo de Humor",
                value: "Un humorista construye un monólogo cómico sobre la vida cotidiana",
                registerInstruction: "Registro coloquial ingenioso. Ironía, exageración y timing. Juegos de palabras. Sin ofensas graves.",
                icon: Drama,
                actions: [
                    { label: "La Observación", value: "Parte de un detalle absurdo de lo cotidiano.", icon: Eye },
                    { label: "La Exageración", value: "Lleva la idea al extremo cómico.", icon: TrendingUp },
                    { label: "El Autorretrato", value: "Se ríe de sus propias manías.", icon: Smile },
                    { label: "El Giro Inesperado", value: "Sorprende con un remate que no se veía venir.", icon: Zap },
                    { label: "La Complicidad", value: "Conecta con lo que todos han vivido.", icon: Users },
                    { label: "El Remate Final", value: "Cierra con el mejor chiste guardado.", icon: Star }
                ]
            },
            {
                label: "Discurso de Despedida",
                value: "Alguien pronuncia un discurso de despedida ante los suyos",
                registerInstruction: "Registro solemne y emotivo, contenido. Gratitud, memoria y proyección. Vocabulario cuidado.",
                icon: HeartHandshake,
                actions: [
                    { label: "El Agradecimiento", value: "Abre agradeciendo a quienes le acompañaron.", icon: Hand },
                    { label: "El Recorrido", value: "Repasa el camino compartido.", icon: Clock },
                    { label: "Una Anécdota", value: "Rescata un momento significativo.", icon: Sparkles },
                    { label: "Lo Aprendido", value: "Comparte las lecciones del trayecto.", icon: Lightbulb },
                    { label: "El Deseo", value: "Expresa sus buenos deseos para el futuro.", icon: Star },
                    { label: "La Despedida", value: "Cierra con una despedida sentida.", icon: Wind }
                ]
            },
            {
                label: "Reflexión sobre el Tiempo",
                value: "Un narrador reflexiona filosóficamente sobre el paso del tiempo",
                registerInstruction: "Registro filosófico y poético. Abstracción, metáfora, matiz. Vocabulario elevado.",
                icon: Clock,
                actions: [
                    { label: "El Tiempo que se Escapa", value: "Medita sobre lo rápido que pasa la vida.", icon: Wind },
                    { label: "La Memoria", value: "Reflexiona sobre cómo recordamos el pasado.", icon: Brain },
                    { label: "El Presente", value: "Explora la dificultad de habitar el ahora.", icon: Eye },
                    { label: "Los Ritmos", value: "Contrasta el tiempo del reloj y el tiempo vivido.", icon: Watch },
                    { label: "El Legado", value: "Piensa en lo que dejamos tras nosotros.", icon: Sprout },
                    { label: "Aceptar la Finitud", value: "Cierra reconciliándose con el paso del tiempo.", icon: Moon }
                ]
            },
            {
                label: "Manifiesto Creativo",
                value: "Un artista expone su visión y principios creativos",
                registerInstruction: "Registro apasionado y programático. Retórica, convicción y matiz. Vocabulario estético.",
                icon: Palette,
                actions: [
                    { label: "La Declaración", value: "Enuncia con fuerza en qué cree.", icon: Flag },
                    { label: "Contra la Corriente", value: "Se posiciona frente a lo establecido.", icon: Ban },
                    { label: "El Método", value: "Explica cómo entiende su propio proceso.", icon: ListChecks },
                    { label: "El Riesgo", value: "Defiende el valor de arriesgarse.", icon: Zap },
                    { label: "El Público", value: "Reflexiona sobre para quién crea.", icon: Users },
                    { label: "La Promesa", value: "Cierra comprometiéndose con su visión.", icon: Star }
                ]
            },
            {
                label: "Carta Abierta",
                value: "Un narrador dirige una carta abierta a alguien o a la sociedad",
                registerInstruction: "Registro público y apelativo. Argumentación emotiva, segunda persona. Vocabulario elaborado.",
                icon: Mail,
                actions: [
                    { label: "El Destinatario", value: "Se dirige a quien va destinada la carta.", icon: Send },
                    { label: "El Motivo", value: "Explica qué le impulsa a escribir.", icon: Zap },
                    { label: "El Reproche o la Súplica", value: "Plantea su demanda con firmeza.", icon: Megaphone },
                    { label: "La Argumentación", value: "Sostiene su postura con razones.", icon: Scale },
                    { label: "La Apelación", value: "Interpela directamente a la conciencia del otro.", icon: Heart },
                    { label: "El Cierre", value: "Termina con un llamado o una esperanza.", icon: Flag }
                ]
            }
        ]
    }
};
